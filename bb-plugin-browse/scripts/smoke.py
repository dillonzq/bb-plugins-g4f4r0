"""Inspect and capture an explicitly selected, already connected browser session."""
import argparse
import json
import subprocess
import time


class Browser:
    def __init__(self, host_id, session_id):
        self.host_id = host_id
        self.session_id = session_id

    @staticmethod
    def call(method, value=None):
        result = subprocess.run(
            ["bb", "browse", method, json.dumps(value or {})],
            capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout)

    def action(self, operation):
        start = time.monotonic()
        job = self.call("run", {"id": self.session_id, "operation": operation})
        while job["status"] == "running":
            time.sleep(0.25)
            job = self.call("job", {"hostId": self.host_id, "id": job["id"]})
        print(json.dumps({"wallSeconds": round(time.monotonic() - start, 3), **job}), flush=True)
        if job["status"] != "succeeded":
            raise RuntimeError(job.get("error", job["status"]))
        return job


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host_id")
    parser.add_argument("session_id")
    args = parser.parse_args()
    browser = Browser(args.host_id, args.session_id)
    browser.action({"kind": "observe", "screenshot": True})
    browser.action({"kind": "batch", "commands": [["get", "title"], ["get", "url"]]})
