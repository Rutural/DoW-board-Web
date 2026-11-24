#!/usr/bin/env python3
"""
브라우저 두 개로 실제 화면을 조작하는 e2e 테스트.
서버를 직접 띄우고(임시 저장 폴더), 끝나면 정리한다. 실패하면 종료 코드 1.

준비: pip install playwright -r ml/requirements.txt && python -m playwright install --with-deps chromium
실행: python3 tests/e2e/run_e2e.py        (스크린샷: tests/e2e/shots/)
"""
import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS = Path(__file__).parent / 'shots'
PORT = int(os.environ.get('E2E_PORT', '3911'))
URL = f'http://127.0.0.1:{PORT}'
SAVE_DIR = tempfile.mkdtemp(prefix='dow-e2e-')
failures = []


def check(cond, msg):
    print(('  ✔ ' if cond else '  ✖ ') + msg)
    if not cond:
        failures.append(msg)


def seed_model_store():
    """테스트 서버 저장소에 실제 파이프라인으로 모델을 하나 학습해 둔다 (게이지 표시 확인용)."""
    subprocess.run([sys.executable, '-m', 'ml.pipeline.run', '--store', os.path.join(SAVE_DIR, 'store'), '--games', '600', '--seed', '1'],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)


def start_server():
    env = {**os.environ, 'PORT': str(PORT), 'SAVE_DIR': SAVE_DIR}
    p = subprocess.Popen(['node', str(ROOT / 'server.js')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            urllib.request.urlopen(URL + '/healthz', timeout=1)
            return p
        except Exception:
            time.sleep(0.1)
    raise RuntimeError('서버가 뜨지 않음')


def stop_server(p):
    # Windows의 terminate()는 SIGTERM이 아니라 강제 종료라 서버의 종료 시 저장이 돌지 않는다.
    # 지연 저장(0.8초)이 끝날 때까지 기다린 뒤 끈다.
    if os.name == 'nt':
        time.sleep(1.5)
    p.terminate()
    p.wait(timeout=10)


async def setup_two_players(a, z, objective='winter'):
    await a.goto(URL); await a.wait_for_selector('#nm')
    await a.fill('#nm', '민지'); await a.select_option('#s-obj', objective)
    await a.screenshot(path=str(SHOTS / '1_lobby.png'))
    await a.click('[data-ui=create]'); await a.wait_for_selector('.code-big')
    code = (await a.inner_text('.code-big')).strip()
    await z.goto(f'{URL}/?room={code}'); await z.wait_for_selector('#nm'); await z.fill('#nm', '준호'); await z.click('[data-ui=join]')
    await a.wait_for_timeout(400)
    await a.click('[data-ui=start]')
    for pg in (a, z):
        await pg.wait_for_selector('.pick')
        for i in range(3):
            await pg.locator('.pick').nth(i).click()
        await pg.locator('[data-ui=leader]').nth(0).click()
        await pg.click('[data-ui=confirmPick]')
    await a.wait_for_selector('.table-board'); await z.wait_for_selector('.table-board')
    await a.wait_for_timeout(300)
    turn = a if await a.query_selector('[data-a="turn.end"]') else z
    return code, turn, (z if turn is a else a)


async def main():
    SHOTS.mkdir(exist_ok=True)
    seed_model_store()
    srv = start_server()
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            a = await (await b.new_context(viewport={'width': 1440, 'height': 1000})).new_page()
            z = await (await b.new_context(viewport={'width': 390, 'height': 844})).new_page()
            for pg, n in ((a, 'A'), (z, 'B')):
                pg.on('pageerror', lambda e, n=n: errs.append(f'{n}: {e}'))
                # 외부 폰트(구글)는 네트워크 환경에 따라 막힐 수 있으므로 제외
                pg.on('response', lambda r, n=n: r.status >= 400 and 'fonts.g' not in r.url and errs.append(f'{n} {r.status} {r.url}'))
                pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))

            print('▶ 시나리오 1: 방 만들기 → 참가 → 생존자 선택')
            code, t, o = await setup_two_players(a, z)
            check(await a.locator('.cboard-img').count() == 1, '피난기지 보드 이미지 표시')
            check(await a.locator('.loc-card').count() == 6, '장소 카드 6장 표시')
            check(await a.locator('.parea.mine .scard-wrap').count() == 3, '내 생존자 카드 3장')
            check(await a.locator('.parea.theirs .hand-fan .pcard.item').count() == 0, '상대 손패 앞면은 보이지 않음')
            check(await a.locator('.pred .gauge').count() == 2, 'AI 예측 게이지 2개(위기 성공 가능성·붕괴 위험) 표시')
            await a.screenshot(path=str(SHOTS / '2_game.png'), full_page=True)
            await z.screenshot(path=str(SHOTS / '3_mobile.png'), full_page=True)

            print('▶ 시나리오 2: 이동 → 탐색 → 위기 기여')
            seat = 0 if t is a else 1
            await t.locator(f'.pawn.p{seat}').first.click()
            await t.select_option('#mv-to', 'police'); await t.check('input[value=none]'); await t.click('[data-ui=moveSurv]')
            await t.wait_for_timeout(200)
            check(await t.locator('.loc-card:has-text("경찰서") .pawn').count() >= 1, '생존자 말이 경찰서로 이동')
            await t.locator('.loc-card:has-text("경찰서") .pawn').first.click()
            await t.click('.modal [data-a="search.start"]')
            await t.wait_for_selector('.modal .search-row')
            await t.click('.modal [data-a="search.more"][data-p*="true"]'); await t.wait_for_timeout(150)
            check(await t.locator('.modal [data-ui=searchSel]').count() == 2, '소음을 내고 카드 1장 더 봄')
            hand_before = await t.locator('.parea.mine .hand-fan .pcard.item').count()
            await t.locator('.modal [data-ui=searchSel]').first.click(); await t.click('[data-ui=searchTake]'); await t.wait_for_timeout(200)
            check(await t.locator('.parea.mine .hand-fan .pcard.item').count() == hand_before + 1, '탐색한 카드 1장이 손패에 들어옴')
            await t.locator('.parea.mine .hand-fan .pcard.item').first.click()
            await t.click('.modal [data-a="card.contribute"]'); await t.wait_for_timeout(200)
            check(await o.locator('.cb-zone.contrib .fan img').count() == 1, '상대 화면에 위기 기여 카드가 뒷면으로 보임')

            print('▶ 시나리오 3: 크로스로드 발동 → 선택')
            await o.click('.parea.mine .xr-hold'); await o.wait_for_selector('.modal')
            await o.click('.modal [data-a="xr.reveal"]'); await t.wait_for_selector('.modal [data-a="xr.choose"]')
            await t.locator('.modal [data-a="xr.choose"]').first.click(); await t.wait_for_timeout(150)
            await t.click('.modal [data-a="xr.done"]'); await t.wait_for_timeout(200)

            print('▶ 시나리오 4: 턴 종료 → 피난기지 단계 → 되돌리기')
            await t.click('[data-a="turn.end"]'); await t.wait_for_timeout(250)
            await o.click('[data-a="turn.end"]'); await o.wait_for_timeout(250)
            for sel in ['colony.food', 'colony.waste', 'crisis.resolve', 'colony.zombies']:
                await a.click(f'[data-a="{sel}"]'); await a.wait_for_timeout(150)
            await a.screenshot(path=str(SHOTS / '4_colony.png'), full_page=True)
            await a.click('[data-a="colony.objective"][data-p*="false"]'); await a.wait_for_timeout(150)
            await a.click('[data-a="colony.next"]'); await a.wait_for_timeout(250)
            check('라운드 9' in await a.inner_text('.log') or '라운드 마커 이동' in await a.inner_text('.log'), '다음 라운드로 진행')
            await a.click('[data-ui=undo]'); await a.wait_for_timeout(250)
            check('되돌렸습니다' in await a.inner_text('.log'), '되돌리기 동작')

            print('▶ 시나리오 5: 새로고침 재접속, 서버 재시작 후 복원')
            await t.reload(); await t.wait_for_selector('.table-board', timeout=6000)
            stop_server(srv); srv = start_server()
            await a.reload(); await a.wait_for_selector('.table-board', timeout=8000)
            check('탐색' in await a.inner_text('.log'), '서버 재시작 후 진행 상황 복원')

            print('▶ 시나리오 6: 샘플 목표 → 샘플 트랙 조작')
            await a.evaluate('localStorage.clear()'); await z.evaluate('localStorage.clear()')
            _, t, o = await setup_two_players(a, z, 'samples')
            await t.click('[data-a="track"][data-p*="samples"][data-p*="\\"d\\":1"]'); await t.wait_for_timeout(200)
            check('1/8' in await o.inner_text('.supply-row'), '샘플 +1이 상대 화면에도 반영 (하드면 목표 8)')
            await b.close()
    finally:
        stop_server(srv)
        shutil.rmtree(SAVE_DIR, ignore_errors=True)

    check(not errs, '페이지 오류·깨진 리소스 없음' + (f' → {errs[:5]}' if errs else ''))
    print(f'\n결과: {"통과" if not failures else f"실패 {len(failures)}건"}')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    asyncio.run(main())
