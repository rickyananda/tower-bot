#!/usr/bin/env python3
"""Circle Faucet Auto-Claimer - Arc Testnet USDC
Runs every 2h to claim 20 USDC per wallet.
Uses sctg.xyz CAPTCHA solver for reCAPTCHA Enterprise invisible.
"""
import json, time, subprocess
from playwright.sync_api import sync_playwright
from datetime import datetime

WALLETS = [
    "0xd06fF3255e00E6cE7Df0e6927732dFbb012d048e",
    "0x7CFbFD7cdBf2faa570187392d4508C7ee0188C1E",
]
FAUCET_URL = "https://faucet.circle.com/"
SITEKEY = "6LcNs_0pAAAAAJuAAa-VQryi8XsocHubBk-YlUy2"
API_KEY = "vQGe8JXzXINS5ddg6HJNGdcU7Xdd2Fnz"
SOLVER_URL = "https://api.sctg.xyz"
LOG_FILE = "/home/user/tower-bot/faucet_claim_log.json"

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")

def curl_cmd(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
    return r.stdout.strip()

def solve_recaptcha():
    log("Solving reCAPTCHA Enterprise...")
    resp = curl_cmd(f'curl -s -X POST "{SOLVER_URL}/in.php" -d "key={API_KEY}" -d "method=userrecaptcha" -d "googlekey={SITEKEY}" -d "pageurl={FAUCET_URL}" -d "invisible=1" -d "enterprise=1"')
    if "OK|" not in resp:
        log(f"Captcha submit failed: {resp}")
        return None
    task_id = resp.split("|")[1]
    for i in range(30):
        time.sleep(5)
        result = curl_cmd(f'curl -s "{SOLVER_URL}/res.php?key={API_KEY}&action=get&id={task_id}"')
        if result.startswith("OK|"):
            token = result.split("|", 1)[1]
            log(f"Captcha solved! ({len(token)} chars)")
            return token
        elif "ERROR" in result:
            log(f"Captcha error: {result}")
            return None
    log("Captcha timeout")
    return None

def save_log(results):
    try:
        with open(LOG_FILE, 'w') as f:
            json.dump({"time": datetime.now().isoformat(), "results": results}, f, indent=2)
    except: pass

def claim(wallet):
    log(f"Claiming: {wallet}")
    
    captcha_token = solve_recaptcha()
    if not captcha_token:
        return {"wallet": wallet, "status": "captcha_failed"}
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
        )
        ctx = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            viewport={'width': 1366, 'height': 768}
        )
        page = ctx.new_page()
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
        
        api_result = None
        def on_resp(response):
            nonlocal api_result
            if 'graphql' in response.url:
                try:
                    body = response.json()
                    if 'requestToken' in json.dumps(body):
                        api_result = body
                except: pass
        page.on('response', on_resp)
        
        try:
            page.goto(FAUCET_URL, wait_until='domcontentloaded', timeout=30000)
            time.sleep(5)
        except Exception as e:
            log(f"Page load error: {e}")
            browser.close()
            return {"wallet": wallet, "status": "page_error", "error": str(e)}
        
        # Inject captcha token
        page.evaluate("""(token) => {
            document.querySelectorAll('textarea[name="g-recaptcha-response"], .g-recaptcha-response, [id*="g-recaptcha-response"]').forEach(el => {
                el.value = token;
                el.innerHTML = token;
            });
            if (window.grecaptcha?.enterprise) window.grecaptcha.enterprise.execute = () => Promise.resolve(token);
            if (window.grecaptcha) window.grecaptcha.execute = () => Promise.resolve(token);
        }""", captcha_token)
        
        # Fill address
        try:
            page.locator('input[name="address"]').fill(wallet, timeout=5000)
        except:
            page.locator('text="Send to"').click()
            time.sleep(0.3)
            page.keyboard.type(wallet, delay=30)
        time.sleep(1)
        
        btn_disabled = page.locator('button[type="submit"]').is_disabled()
        
        if not btn_disabled:
            page.locator('button[type="submit"]').click()
        else:
            page.locator('button[type="submit"]').click(force=True)
        
        # Wait for API response
        for i in range(30):
            time.sleep(1)
            if api_result:
                break
        time.sleep(3)
        
        browser.close()
        
        # Parse result
        if api_result:
            r_str = json.dumps(api_result)
            if '"hash"' in r_str:
                h = api_result.get('data', {}).get('requestToken', {}).get('hash', '')
                log(f"SUCCESS! TX: {h}")
                return {"wallet": wallet, "status": "success", "tx": h}
            elif 'RECAPTCHA_ERROR' in r_str:
                page_text = ""
                if 'unusual traffic' in page_text.lower():
                    log(f"BLOCKED: Unusual traffic")
                    return {"wallet": wallet, "status": "blocked"}
                else:
                    log(f"RECAPTCHA ERROR (may be rate limited)")
                    return {"wallet": wallet, "status": "recaptcha_error"}
            elif 'limit' in r_str.lower():
                log(f"RATE LIMITED")
                return {"wallet": wallet, "status": "rate_limited"}
            else:
                log(f"API: {r_str[:200]}")
                return {"wallet": wallet, "status": "unknown", "response": r_str[:200]}
        
        log("No API response captured")
        return {"wallet": wallet, "status": "no_response"}

# Main
log("=" * 40)
log("CIRCLE FAUCET AUTO-CLAIMER")
log("=" * 40)

results = []
for w in WALLETS:
    try:
        r = claim(w)
        results.append(r)
    except Exception as e:
        log(f"Error: {e}")
        results.append({"wallet": w, "status": "error", "error": str(e)})
    time.sleep(3)

save_log(results)

success = sum(1 for r in results if r.get("status") == "success")
log(f"DONE: {success}/{len(WALLETS)} claimed")

# Print summary
for r in results:
    log(f"  {r['wallet'][:15]}... → {r['status']}")
