"""Creates the two local test accounts (see .env.example) with finished brand profiles.
Run against whichever STORAGE is configured. Refuses to run in production."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.repo import BrandRec, EmailTaken, get_repo
from backend.app.security import hash_password
from backend.app.settings import settings

if settings.is_production:
    sys.exit("Not seeding demo accounts in production.")

PRI = {"market_saturation": 3, "cannibalisation": 2, "surrounding_amenities": 3, "transit_accessibility": 3, "demographic_match": 2}
ACCOUNTS = [
    ("owner@tealab.test", "hexagon-tea-lab-42", "Tea Lab Owner",
     BrandRec(name="Tea Lab", vertical="bubble_tea", description="Fresh-brewed bubble tea for students and office workers",
              store_format="kiosk", store_count_band="1", priorities=PRI, regions=["cbd", "inner_west"], onboarded=True)),
    ("shots@tarrow.test", "tarrow-demo-shots-7", "Tarrow Demo",
     BrandRec(name="Tarrow Tea", vertical="bubble_tea", description="Small-batch milk tea and fruit tea",
              store_format="takeaway", store_count_band="2-5", priorities=PRI, regions=["cbd"], onboarded=True)),
]

repo = get_repo()
for email, pw, name, brand in ACCOUNTS:
    try:
        user = repo.create_user(email, hash_password(pw), name)
    except EmailTaken:
        print(f"exists: {email}")
        continue
    repo.update_user(user.id, tour_done=True)
    repo.save_brand(user.id, brand)
    print(f"created: {email}")
