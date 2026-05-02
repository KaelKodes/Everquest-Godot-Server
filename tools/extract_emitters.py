import re
import json
import sys

def extract_edd(filepath):
    try:
        with open(filepath, 'rb') as f:
            data = f.read()
            
        # Find all ASCII strings 4+ chars long
        strings = re.findall(b'[A-Za-z0-9_]+\.(?:dds|tga|bmp)', data, re.IGNORECASE)
        
        # Deduplicate while preserving order
        seen = set()
        textures = []
        for s in strings:
            decoded = s.decode('ascii').lower()
            if decoded not in seen:
                seen.add(decoded)
                textures.append(decoded)
                
        return textures
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return []

if __name__ == "__main__":
    files = [
        "D:/everquest_rof2/everquest_rof2/spellsnew.edd",
        "D:/everquest_rof2/everquest_rof2/actoremittersnew.edd",
        "D:/everquest_rof2/everquest_rof2/environmentemittersnew.edd"
    ]
    
    result = {}
    for f in files:
        name = f.split("/")[-1]
        result[name] = extract_edd(f)
        
    with open("D:/Kael Kodes/EQMUD/server/tools/emitters.json", "w") as out:
        json.dump(result, out, indent=2)
        
    print(f"Extracted {len(result['spellsnew.edd'])} textures from spellsnew.edd")
