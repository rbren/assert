"""Exercise the real API, database and HTTP client without launching live agents."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
from assert_app.models import Assertion, Base, Project, ProposedFix, Run
from sqlalchemy import create_engine
from sqlalchemy.orm import Session


class AgentHandler(BaseHTTPRequestHandler):
    # A loopback upstream lets us reproduce auth/transport failures without
    # changing production credentials or dispatching paid agents.
    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def respond(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.server.requests.append((self.command, self.path, dict(self.headers), body))
        status, payload = self.server.responses[self.path]
        if status is None:
            self.close_connection = True
            return
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


class AgentFailureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.data = Path(cls.temp.name)
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), AgentHandler)
        cls.addClassCleanup(cls.upstream.server_close)
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.upstream.shutdown)
        cls.engine = create_engine(f"sqlite:///{cls.data / 'assert.db'}")
        cls.addClassCleanup(cls.engine.dispose)
        Base.metadata.create_all(cls.engine)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        backend = Path(__file__).resolve().parent
        env = {
            **os.environ,
            "PYTHONPATH": str(backend),
            "ASSERT_DATA_ROOT": str(cls.data),
            "ASSERT_AGENT_SERVER_URL": f"http://127.0.0.1:{cls.upstream.server_port}",
            "OH_SESSION_API_KEYS_0": "test-session-key",
            "ASSERT_POLL_SECONDS": "3600",
        }
        cls.logs = (cls.data / "backend.log").open("w+")
        cls.addClassCleanup(cls.logs.close)
        cls.process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "assert_app.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=backend,
            env=env,
            stdout=cls.logs,
            stderr=subprocess.STDOUT,
        )
        cls.addClassCleanup(cls.stop_backend)
        cls.client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10)
        cls.addClassCleanup(cls.client.close)
        for _ in range(100):
            try:
                if cls.client.get("/api/health").status_code == 200:
                    return
            except httpx.TransportError:
                pass
            if cls.process.poll() is not None:
                break
            time.sleep(0.05)
        cls.logs.seek(0)
        raise RuntimeError(f"Test backend did not start: {cls.logs.read()}")

    @classmethod
    def stop_backend(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=10)

    def setUp(self):
        self.upstream.requests = []
        self.upstream.responses = {
            "/api/settings": (
                200,
                {
                    "agent_settings": {
                        "schema_version": "test-version",
                        "llm": {"api_key": "test-encrypted-key", "model": "test-model"},
                        "tools": [],
                    }
                },
            ),
            "/api/conversations": (200, {"id": "test-conversation"}),
        }
        slug = self._testMethodName
        checkout = self.data / "checkouts" / slug
        checkout.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(checkout)], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(checkout),
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "Initial",
            ],
            check=True,
        )
        with Session(self.engine) as db:
            project = Project(
                repo_url=f"https://example.invalid/{slug}.git",
                slug=slug,
                clone_status="ready",
            )
            assertion = Assertion(project=project, raw_text="A claim", text="A claim")
            db.add(assertion)
            db.commit()
            self.assertion_id = assertion.id
        self.path = f"/api/assertions/{self.assertion_id}"

    def assert_unavailable(self, response, message):
        self.assertEqual(response.status_code, 503, response.text)
        self.assertIn(message, response.json()["detail"].lower())
        for private in (
            "upstream-private-detail",
            "test-session-key",
            "test-encrypted-key",
            "127.0.0.1",
        ):
            self.assertNotIn(private, response.text)
        return response.json()["detail"]

    def test_settings_auth_failure_is_recorded_and_retryable(self):
        for status in (401, 403):
            with self.subTest(status=status):
                self.upstream.responses["/api/settings"] = (
                    status,
                    {"detail": "upstream-private-detail"},
                )
                response = self.client.post(self.path + "/verify")
                detail = self.assert_unavailable(response, "credential")
                run = self.client.get(self.path + "/runs").json()[0]
                self.assertEqual(run["status"], "error")
                self.assertEqual(run["error"], f"Could not start agent: {detail}")
                self.assertIsNotNone(run["finished_at"])
                self.assertIsNone(run["conversation_id"])
        self.assertFalse(
            any(
                path == "/api/conversations" for _, path, _, _ in self.upstream.requests
            )
        )
        self.upstream.responses["/api/settings"] = (
            200,
            {"agent_settings": {"llm": {"api_key": "test-encrypted-key"}}},
        )
        retry = self.client.post(self.path + "/verify")
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(retry.json()["latest_run"]["status"], "investigating")
        self.assertEqual(self.client.post(self.path + "/verify").status_code, 409)

    def test_dispatch_http_failures_are_sanitized_without_retry(self):
        for status in (401, 403, 429, 500, 503):
            with self.subTest(status=status):
                self.upstream.requests = []
                self.upstream.responses["/api/conversations"] = (
                    status,
                    {"detail": "upstream-private-detail"},
                )
                response = self.client.post(self.path + "/verify")
                self.assert_unavailable(
                    response, "credential" if status in (401, 403) else "agent"
                )
                self.assertEqual(
                    [path for _, path, _, _ in self.upstream.requests],
                    ["/api/settings", "/api/conversations"],
                )

    def test_transport_failure_is_service_unavailable(self):
        self.upstream.responses["/api/settings"] = (None, None)
        self.assert_unavailable(self.client.post(self.path + "/verify"), "unavailable")

    def test_missing_agent_profile_is_service_unavailable(self):
        self.upstream.responses["/api/settings"] = (200, {})
        self.assert_unavailable(self.client.post(self.path + "/verify"), "profile")

    def test_edit_uses_same_agent_error_handling(self):
        self.upstream.responses["/api/settings"] = (
            401,
            {"detail": "upstream-private-detail"},
        )
        self.assert_unavailable(
            self.client.patch(self.path, json={"text": "An edited claim"}), "credential"
        )
        self.assertEqual(
            self.client.get(self.path).json()["latest_run"]["status"], "error"
        )

    def test_remediation_auth_failure_is_not_a_conflict(self):
        with Session(self.engine) as db:
            run = Run(assertion_id=self.assertion_id, status="done", verdict="false")
            run.fixes.append(ProposedFix(title="Fix claim", plan="Implement the claim"))
            db.add(run)
            db.commit()
        self.upstream.responses["/api/settings"] = (
            401,
            {"detail": "upstream-private-detail"},
        )
        detail = self.assert_unavailable(
            self.client.post(self.path + "/remediate"), "credential"
        )
        rem = self.client.get(self.path + "/remediations").json()[0]
        self.assertEqual(rem["status"], "error")
        self.assertEqual(rem["error"], f"Could not start agent: {detail}")
        self.assertIsNotNone(rem["finished_at"])

    def test_success_preserves_auth_and_encrypted_secret_roundtrip(self):
        response = self.client.post(self.path + "/verify")
        self.assertEqual(response.status_code, 200, response.text)
        run = response.json()["latest_run"]
        self.assertEqual(run["conversation_id"], "test-conversation")
        self.assertEqual(run["status"], "investigating")
        self.assertIsNone(run["error"])
        settings, dispatch = self.upstream.requests
        self.assertEqual(settings[2]["X-Expose-Secrets"], "encrypted")
        for request in (settings, dispatch):
            self.assertEqual(request[2]["X-Session-API-Key"], "test-session-key")
        payload = json.loads(dispatch[3])
        self.assertTrue(payload["secrets_encrypted"])
        self.assertEqual(
            payload["agent_settings"]["llm"]["api_key"], "test-encrypted-key"
        )
        self.assertNotIn("schema_version", payload["agent_settings"])
        self.assertTrue(payload["agent_settings"]["tools"])


if __name__ == "__main__":
    unittest.main()
