#!/usr/bin/env python3
"""Circle Faucet Auto-Claimer - Arc Testnet USDC
Supports residential proxy for bypassing reCAPTCHA Enterprise IP checks.
"""
import json, time, subprocess, sys
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
CONFIG_FILE = "/home/user/tower-bot/faucet_config.json"

def load_config():
    """Load config with proxy settings."""
    default = {
        "proxy": "",  # Format: "http://user:pass@ip:port" or "socks5://ip:port"
        "wallets": WALLETS,
        "use_cloakbrowser": True,
        "cloakbrowser_path": "/home/user/.cloakbrowser/chromium-146.0.7680.177.5/chrome"
    }
    try:
        with open(CONFIG_FILE) as f:
            cfg = json.load(f)
            default.update(cfg)
    except:
        pass
    return default

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")

def curl_cmd(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
    return r.stdout.strip()

def solve_recaptcha(proxy=""):
    log("Solving reCAPTCHA Enterprise...")
    proxy_arg = f'--proxy "{proxy}" -k' if proxy else ''
    resp = curl_cmd(f'curl -s {proxy_arg} -X POST "{SOLVER_URL}/in.php" -d "key={API_KEY}" -d "method=userrecaptcha" -d "googlekey={SITEKEY}" -d "pageurl={FAUCET_URL}" -d "invisible=1" -d "enterprise=1"')
    if "OK|" not in resp:
        log(f"Captcha submit failed: {resp}")
        return None
    task_id = resp.split("|")[1]
    for i in range(30):
        time.sleep(5)
        result = curl_cmd(f'curl -s {proxy_arg} "{SOLVER_URL}/res.php?key={API_KEY}&action=get&id={task_id}"')
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

def claim(wallet, config):
    log(f"Claiming: {wallet}")
    proxy = config.get("proxy", "")
    use_cloak = config.get("use_cloakbrowser", True)
    cloak_path = config.get("cloakbrowser_path", "")
    
    captcha_token = solve_recaptcha(proxy)
    if not captcha_token:
        return {"wallet": wallet, "status": "captcha_failed"}
    
    with sync_playwright() as p:
        launch_args = {
            'headless': True,
            'args': ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
        }
        if use_cloak and cloak_path:
            launch_args['executable_path'] = cloak_path
        
        browser = p.chromium.launch(**launch_args)
        
        ctx_args = {
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            'viewport': {'width': 1366, 'height': 768},
            'locale': 'en-US',
        }
        if proxy:
            ctx_args['proxy'] = {"server": proxy}
        
        ctx = browser.new_context(**ctx_args)
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
        
        # Fill address with React-compatible events
        page.evaluate("""(address) => {
            const input = document.querySelector('input[name="address"]');
            if (!input) return;
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, address);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }""", wallet)
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
        
        # Check result
        body = page.inner_text('body')
        browser.close()
        
        if api_result:
            r_str = json.dumps(api_result)
            if '"hash"' in r_str:
                h = api_result.get('data', {}).get('requestToken', {}).get('hash', '')
                log(f"SUCCESS! TX: {h}")
                return {"wallet": wallet, "status": "success", "tx": h}
            elif 'RECAPTCHA_ERROR' in r_str:
                if 'unusual traffic' in body.lower():
                    log(f"BLOCKED: Unusual traffic (need residential proxy)")
                    return {"wallet": wallet, "status": "blocked"}
                else:
                    log(f"RECAPTCHA ERROR")
                    return {"wallet": wallet, "status": "recaptcha_error"}
            elif 'limit' in r_str.lower():
                log(f"RATE LIMITED")
                return {"wallet": wallet, "status": "rate_limited"}
        
        if 'unusual traffic' in body.lower():
            log(f"BLOCKED: Unusual traffic")
            return {"wallet": wallet, "status": "blocked"}
        elif 'sent' in body.lower() and 'usdc' in body.lower():
            log(f"SUCCESS (detected from page)")
            return {"wallet": wallet, "status": "success"}
        elif 'limit' in body.lower():
            log(f"RATE LIMITED (detected from page)")
            return {"wallet": wallet, "status": "rate_limited"}
        
        log(f"No clear result")
        return {"wallet": wallet, "status": "no_response"}

# Main
config = load_config()
log("=" * 40)
log("CIRCLE FAUCET AUTO-CLAIMER")
log(f"Proxy: {config.get('proxy', 'NONE')}")
log(f"Wallets: {len(config.get('wallets', WALLETS))}")
log("=" * 40)

results = []
for w in config.get("wallets", WALLETS):
    try:
        r = claim(w, config)
        results.append(r)
    except Exception as e:
        log(f"Error: {e}")
        results.append({"wallet": w, "status": "error", "error": str(e)})
    time.sleep(3)

save_log(results)

success = sum(1 for r in results if r.get("status") == "success")
blocked = sum(1 for r in results if r.get("status") == "blocked")
log(f"DONE: {success}/{len(results)} claimed, {blocked} blocked")

for r in results:
    log(f"  {r['wallet'][:15]}... → {r['status']}")
