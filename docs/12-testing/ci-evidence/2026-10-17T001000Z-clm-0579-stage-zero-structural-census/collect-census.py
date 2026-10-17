#!/usr/bin/env python3
"""CLM-0579 — Stage Zero structural census collector (corrected).

Reproducible on any SHA:
    python3 collect-census.py <full_sha>

Outputs the per-component tracked-file counts used in raw-structural-census-fixed.json.
Method: git ls-tree -r --name-only on the named SHA (tracked files only).
"""
import subprocess, sys, json

def main(sha):
    out = subprocess.run(['git','ls-tree','-r','--name-only',sha],capture_output=True,text=True).stdout.split('\n')
    files=[f for f in out if f]
    def second_level(base):
        s=set()
        for f in files:
            if f.startswith(base+'/'):
                parts=f.split('/')
                if len(parts)>2: s.add(parts[1])
        return sorted(s)
    census={}
    for base in ('services','apps','bots','packages','infra'):
        for name in second_level(base):
            prefix=base+'/'+name+'/'
            under=[f for f in files if f.startswith(prefix)]
            src=[f for f in under if f.endswith('.ts') and not (f.endswith('.test.ts') or f.endswith('.integration.ts'))]
            test=[f for f in under if f.endswith('.test.ts') or f.endswith('.integration.ts')]
            census[base+'/'+name]={
                'tracked_files':len(under),
                'src_ts':len(src),
                'test_ts':len(test),
                'package_json':any(f==base+'/'+name+'/package.json' for f in under),
                'dockerfile':any(f.split('/')[-1].startswith('Dockerfile') for f in under),
                'api_openapi':any(f.endswith('api.openapi.yml') for f in under),
                'schema_sql':any(f.endswith('schema.sql') for f in under),
                'events_json':any(f.endswith('events.json') for f in under),
                'placeholder_gitkeep_only': not any(not f.endswith('.gitkeep') for f in under),
            }
    print(json.dumps(census, indent=2, ensure_ascii=False))

if __name__=='__main__':
    main(sys.argv[1] if len(sys.argv)>1 else 'HEAD')
