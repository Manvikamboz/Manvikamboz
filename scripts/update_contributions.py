#!/usr/bin/env python3

import json
import os
import urllib.request
from pathlib import Path

USERNAME = "Manvikamboz"
README = Path("README.md")
START = "<!--START_SECTION:contributions-->"
END = "<!--END_SECTION:contributions-->"

QUERY = """
query($searchQuery: String!) {
  search(query: $searchQuery, type: ISSUE, first: 5) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        state
        mergedAt
        repository { nameWithOwner }
        closingIssuesReferences(first: 5) {
          nodes {
            number
            title
            url
          }
        }
      }
    }
  }
}
"""


def escape(value):
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def fetch_pull_requests():
    token = os.environ["GITHUB_TOKEN"]
    payload = json.dumps({
        "query": QUERY,
        "variables": {
            "searchQuery": f"author:{USERNAME} is:pr sort:updated-desc"
        },
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://api.github.com/graphql",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "profile-readme-updater",
        },
    )
    with urllib.request.urlopen(request) as response:
        result = json.load(response)
    if result.get("errors"):
        raise RuntimeError(result["errors"])
    return [node for node in result["data"]["search"]["nodes"] if node]


def make_table(pull_requests):
    lines = [
        "| Pull Request | Related Issue | Repository | Status |",
        "| --- | --- | --- | --- |",
    ]
    for pr in pull_requests:
        pr_link = f"[#{pr['number']} {escape(pr['title'])}]({pr['url']})"
        issues = pr["closingIssuesReferences"]["nodes"]
        issue_links = "<br>".join(
            f"[#{issue['number']} {escape(issue['title'])}]({issue['url']})"
            for issue in issues
        ) or "Not linked"
        repository = escape(pr["repository"]["nameWithOwner"])
        status = "Merged" if pr["mergedAt"] else pr["state"].title()
        lines.append(f"| {pr_link} | {issue_links} | `{repository}` | {status} |")
    if not pull_requests:
        lines.append("| No public pull requests found | - | - | - |")
    return "\n".join(lines)


def main():
    content = README.read_text(encoding="utf-8")
    before, remainder = content.split(START, 1)
    _, after = remainder.split(END, 1)
    table = make_table(fetch_pull_requests())
    README.write_text(f"{before}{START}\n{table}\n{END}{after}", encoding="utf-8")


if __name__ == "__main__":
    main()
