"""Writes every Prometheus query of the Grafana dashboards as a recording rule, so promtool can check its syntax.

Usage: python3 deploy/monitoring/dashboard-queries.py > rules.yml && promtool check rules rules.yml
"""
import glob
import json
import os
import re
import sys

here = os.path.dirname(os.path.abspath(__file__))


def panels(items):
    for item in items:
        yield item
        yield from panels(item.get("panels", []))


lines = ["groups:"]
for path in sorted(glob.glob(os.path.join(here, "grafana", "dashboards", "*.json"))):
    with open(path, encoding="utf8") as f:
        dashboard = json.load(f)
    lines.append(f"  - name: {os.path.basename(path)}")
    lines.append("    rules:")
    count = 0
    for panel in panels(dashboard["panels"]):
        for target in panel.get("targets", []):
            source = (target.get("datasource") or panel.get("datasource") or {}).get("type")
            if source != "prometheus" or not target.get("expr"):
                continue
            # Template variables become a plain value; the syntax is what promtool checks.
            expr = re.sub(r"\$\{?\w+\}?", "x", target["expr"])
            count += 1
            lines.append(f"      - record: dashboard_query_{count}")
            lines.append(f"        expr: {json.dumps(expr)}")
    if count == 0:
        lines.pop()
        lines.pop()
sys.stdout.write("\n".join(lines) + "\n")
