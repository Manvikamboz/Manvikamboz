#!/usr/bin/env python3

import json
import os
import re
import urllib.error
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
        body
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


def fetch_issue(repository, number):
    token = os.environ["GITHUB_TOKEN"]
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/issues/{number}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "profile-readme-updater",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            issue = json.load(response)
    except urllib.error.HTTPError:
        return None
    if "pull_request" in issue:
        return None
    return {
        "number": issue["number"],
        "title": issue["title"],
        "url": issue["html_url"],
    }


def related_issues(pr):
    issues = pr["closingIssuesReferences"]["nodes"]
    if issues:
        return issues

    repository = pr["repository"]["nameWithOwner"]
    references = dict.fromkeys(re.findall(r"\#(\d+)", pr.get("body") or ""))
    resolved = []
    for number in list(references)[:5]:
        if int(number) == pr["number"]:
            continue
        issue = fetch_issue(repository, number)
        if issue:
            resolved.append(issue)
    return resolved


def make_table(pull_requests):
    lines = [
        "| Pull Request | Related Issue | Repository | Status |",
        "| --- | --- | --- | --- |",
    ]
    for pr in pull_requests:
        pr_link = f"[#{pr['number']} {escape(pr['title'])}]({pr['url']})"
        issues = related_issues(pr)
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
