import json
from pathlib import Path

p = Path("leaderboard/db.json")
data = json.loads(p.read_text(encoding="utf-8"))

errors = []
schools = data.get("schools", [])
names = [s.get("name") for s in schools]

# check for missing sequential P-names up to max found
expected_prefixes = sorted([int(n[1:]) for n in names if isinstance(n,str) and n.startswith("P")])
if expected_prefixes:
    missing = [i for i in range(1, expected_prefixes[-1]+1) if i not in expected_prefixes]
    if missing:
        errors.append(f"Missing school objects: {', '.join('P'+str(m) for m in missing)}")

for i, s in enumerate(schools):
    name = s.get("name", f"<index {i}>")
    pts = s.get("points")
    ev = s.get("events", [])
    evp = s.get("eventpoints", [])
    if not isinstance(pts, (int, float)):
        errors.append(f"{name}: points is not numeric ({pts!r})")
    if len(ev) != len(evp):
        errors.append(f"{name}: events length {len(ev)} != eventpoints length {len(evp)}")
    # find suspicious eventpoints values
    for j, v in enumerate(evp):
        if not isinstance(v, (int, float)):
            errors.append(f"{name}: eventpoints[{j}] is not numeric ({v!r})")
        elif v not in (0, 20):
            errors.append(f"{name}: eventpoints[{j}] has unexpected value {v} (expected 0 or 20)")

print("Validation results:")
if not errors:
    print("No problems found.")
else:
    for e in errors:
        print("-", e)

for s in data.get("schools", []):
    if s.get("name") == "P7":
        evp = s.get("eventpoints", [])
        changed = False
        for i, v in enumerate(evp):
            if isinstance(v, (int, float)) and v > 20:
                evp[i] = 20
                changed = True
        if changed:
            s["points"] = sum(evp)
            p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"Fixed P7: set large eventpoints -> 20 and updated points to {s['points']}")
        else:
            print("P7 has no eventpoints > 20; no change made.")
        break
else:
    print("P7 not found in leaderboard/db.json")