#!/usr/bin/env python3
"""Claim Circle faucet - v8 native Playwright fill + headless."""
import json, time
from playwright.sync_api import sync_playwright

WALLETS = [
    "0xd06fF3255e00E6cE7Df0e6927732dFbb012d048e",
    "0x7CFbFD7cdBf2faa570187392d4508C7ee0188C1E",
]
FAUCET_URL = "https://faucet.circle.com/"

def claim(wallet):
    print(f"\n{'='*50}")
    print(f"Claiming: {wallet}")
    print(f"{'='*50}")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-blink-features=AutomationControlled']
        )
        ctx = browser.new_context(
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            viewport={'width': 1280, 'height': 800}
        )
        page = ctx.new_page()
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        """)
        
        api_responses = []
        def on_resp(response):
            if 'graphql' in response.url:
                try:
                    body = response.json()
                    api_responses.append(body)
                    print(f"  [API] {json.dumps(body)[:300]}")
                except: pass
        page.on('response', on_resp)
        
        print("[1] Loading page...")
        page.goto(FAUCET_URL, wait_until='domcontentloaded', timeout=30000)
        time.sleep(5)
        
        print("[2] Filling address using Playwright native fill...")
        # Use Playwright's native fill on the specific input
        addr_input = page.locator('input[name="address"]')
        addr_input.fill(wallet)
        time.sleep(1)
        
        # Verify
        val = addr_input.input_value()
        print(f"  [DEBUG] Input value: {val[:30]}...")
        
        btn_disabled = page.locator('button[type="submit"]').is_disabled()
        print(f"  [DEBUG] Button disabled: {btn_disabled}")
        
        if btn_disabled:
            # The input might need focus + blur to trigger validation
            print("[2b] Triggering focus/blur for validation...")
            addr_input.focus()
            time.sleep(0.3)
            addr_input.blur()
            time.sleep(1)
            btn_disabled = page.locator('button[type="submit"]').is_disabled()
            print(f"  [DEBUG] Button disabled after blur: {btn_disabled}")
        
        if not btn_disabled:
            print("[3] Button enabled! Clicking...")
            page.locator('button[type="submit"]').click()
        else:
            print("[3] Button still disabled. Trying alternative approach...")
            # Type character by character to trigger React's onChange
            addr_input.fill('')
            time.sleep(0.5)
            addr_input.type(wallet, delay=30)
            time.sleep(1)
            btn_disabled = page.locator('button[type="submit"]').is_disabled()
            print(f"  [DEBUG] Button disabled after type: {btn_disabled}")
            
            if not btn_disabled:
                print("[3b] Button enabled now! Clicking...")
                page.locator('button[type="submit"]').click()
            else:
                print("[3c] Force click...")
                page.locator('button[type="submit"]').click(force=True)
        
        print("[4] Waiting for response...")
        for i in range(30):
            time.sleep(1)
            if api_responses:
                break
        time.sleep(5)
        
        # Check results
        for r in api_responses:
            r_str = json.dumps(r)
            if 'requestToken' in r_str:
                if '"hash"' in r_str:
                    h = r.get('data', {}).get('requestToken', {}).get('hash', '')
                    print(f"[SUCCESS] TX Hash: {h}")
                    browser.close()
                    return True
                elif 'RECAPTCHA_ERROR' in r_str:
                    print(f"[RECAPTCHA ERROR]")
                else:
                    print(f"[API] {r_str[:300]}")
        
        body = page.inner_text('body')
        if 'has been sent' in body.lower():
            print(f"[SUCCESS via page text]")
            browser.close()
            return True
        
        print(f"[RESULT] {body[:300]}")
        browser.close()
        return False

success = 0
for w in WALLETS:
    try:
        if claim(w):
            success += 1
    except Exception as e:
        print(f"[ERROR] {e}")
    time.sleep(3)

print(f"\nDONE: {success}/{len(WALLETS)} wallets claimed")
