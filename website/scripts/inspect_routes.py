import urllib.request
url = 'http://localhost:3000/__docusaurus/debug/routes'
html = urllib.request.urlopen(url).read().decode('utf-8', errors='ignore')
for line in html.splitlines():
    if 'pt-BR' in line or '/docs' in line:
        print(line)
