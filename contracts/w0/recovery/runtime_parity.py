import hashlib, json, platform
with open("fixtures/valid.json", encoding="utf-8") as handle:
    fixtures=json.load(handle)
encoded=json.dumps(fixtures, sort_keys=True, separators=(",",":"), ensure_ascii=False).encode()
print(json.dumps({"runtime":platform.python_version(),"fixtureCount":len(fixtures["cases"]),"canonicalSha256":hashlib.sha256(encoded).hexdigest()}, separators=(",",":")))
