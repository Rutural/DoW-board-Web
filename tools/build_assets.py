#!/usr/bin/env python3
"""
업로드한 이미지 ZIP(을 푼 폴더)과 본판 데이터 JSON으로 웹용 이미지를 만든다.

사용법:
  python3 tools/build_assets.py <이미지 폴더> <본판 데이터 JSON>
    <이미지 폴더> : 공용 ZIP과 본판 카드 ZIP을 같은 곳에 푼 폴더 (cards/, images/ 가 있어야 함)

결과:
  public/assets/...    웹에서 쓰는 이미지 (크기 줄이고 필요한 부분만 잘라냄)
  data/images.json     게임 데이터 id → 이미지 경로 매핑
  data/item_cards.json 장소별 아이템 덱 (카드 한 장마다 고유 그림)
필요: pip install pillow numpy
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SRC = Path(sys.argv[1])
BASE_JSON = Path(sys.argv[2])
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'assets'
DATA = ROOT / 'data'

CARD_W = 420


def save_jpg(im, rel, w=None, q=80):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im = im.convert('RGB')
    if w and im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(p, 'JPEG', quality=q, optimize=True, progressive=True)
    return 'assets/' + rel


def save_png(im, rel, size=None):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if size:
        im = im.resize((size, round(im.height * size / im.width)), Image.LANCZOS)
    im.save(p, 'PNG', optimize=True)
    return 'assets/' + rel


def circle(im, box, size):
    im = im.convert('RGBA').crop(box).resize((size, size), Image.LANCZOS)
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).ellipse((2, 2, size * 4 - 3, size * 4 - 3), fill=255)
    im.putalpha(m.resize((size, size), Image.LANCZOS))
    return im


def bright_bbox(im, box, thr=190):
    a = np.asarray(im.convert('L').crop(box))
    ys, xs = np.where(a > thr)
    x0, y0 = box[0], box[1]
    return (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)


def card(rel_src, rel_dst):
    return save_jpg(Image.open(SRC / rel_src), rel_dst, CARD_W)


def main():
    d = json.loads(BASE_JSON.read_text(encoding='utf-8'))
    my_surv = json.loads((DATA / 'survivors.json').read_text(encoding='utf-8'))
    my_game = json.loads((DATA / 'game.json').read_text(encoding='utf-8'))
    my_xr = json.loads((DATA / 'crossroads.json').read_text(encoding='utf-8'))
    m = {'survivors': {}, 'crises': {}, 'objectives': {}, 'crossroads': {}, 'board': {}, 'tokens': {}, 'locations': {}}

    # ── 보드 ──
    I = SRC / 'images'
    m['board']['colony'] = save_jpg(Image.open(I / 'boards/colony_board.jpg'), 'board/colony.jpg', 1200, 82)
    m['board']['occupants'] = save_jpg(Image.open(I / 'boards/colony_occupants_21_spaces.jpg'), 'board/occupants.jpg', 420, 80)
    m['board']['sheet'] = save_jpg(Image.open(I / 'boards/player_reference_sheet.png'), 'board/sheet.jpg', 1100, 80)
    m['board']['searchPanel'] = save_jpg(Image.open(I / 'boards/location_search_panel.jpg'), 'board/search_panel.jpg', 360, 80)
    m['board']['itemBack'] = save_jpg(Image.open(I / 'card_backs/Starter Items.jpg'), 'board/item_back.jpg', 300, 80)
    m['board']['thumbUp'] = save_png(Image.open(I / 'boards/vote_thumbs_up.png').convert('RGBA'), 'board/thumb_up.png', 160)
    m['board']['thumbDown'] = save_png(Image.open(I / 'boards/vote_thumbs_down.png').convert('RGBA'), 'board/thumb_down.png', 160)

    # ── 토큰 ──
    T = I / 'tokens'
    wf = Image.open(T / 'Wound _ Frostbite_Custom_Model.jpg')
    m['tokens']['frost'] = save_png(wf.convert('RGBA').crop(bright_bbox(wf, (0, 0, 512, 512))), 'tokens/frost.png', 96)
    m['tokens']['wound'] = save_png(wf.convert('RGBA').crop(bright_bbox(wf, (512, 512, 1024, 1024))), 'tokens/wound.png', 96)
    fs = Image.open(T / 'Food _  Starvation_Custom_Model.jpg')
    m['tokens']['food'] = save_png(circle(fs, (40, 40, 470, 470), 128), 'tokens/food.png')
    m['tokens']['starve'] = save_png(circle(fs, (556, 556, 990, 990), 128), 'tokens/starve.png')
    nz = Image.open(T / 'Noise Token.png')
    m['tokens']['noise'] = save_png(nz.convert('RGBA').crop((133, 608, 436, 899)), 'tokens/noise.png', 96)
    m['tokens']['barricade'] = save_png(circle(Image.open(T / 'Barricade _ Trap_Custom_Tile.jpg'), (6, 6, 250, 250), 112), 'tokens/barricade.png')
    m['tokens']['helpless'] = save_png(circle(Image.open(T / 'Helpless _ Unruly_Custom_Tile.jpg'), (8, 8, 248, 248), 128), 'tokens/helpless.png')
    m['tokens']['zombie'] = save_png(circle(Image.open(I / 'standees/zombies/Zombie.png'), (19, 17, 265, 263), 112), 'tokens/zombie.png')
    m['tokens']['morale'] = save_png(Image.open(T / 'Morale Tracker.jpg').convert('RGBA').crop((62, 61, 447, 322)), 'tokens/morale.png', 120)
    m['tokens']['round'] = save_png(Image.open(T / 'Round Tracker.jpg').convert('RGBA').crop((61, 63, 448, 323)), 'tokens/round.png', 120)
    m['tokens']['firstPlayer'] = save_png(Image.open(T / 'First Player Token.jpg').convert('RGBA').crop((116, 486, 974, 754)), 'tokens/first_player.png', 220)
    # 흰 배경 투명 처리(마커·시작 토큰)
    for k in ('morale', 'round', 'firstPlayer', 'noise'):
        p = ROOT / 'public' / m['tokens'][k]
        im = Image.open(p).convert('RGBA'); a = np.asarray(im).copy()
        white = (a[..., :3] > 238).all(-1)
        a[white, 3] = 0
        Image.fromarray(a).save(p)

    # ── 장소 그림(3D 건물 외벽 텍스처에서 잘라냄) ──
    L = I / 'locations_3d_textures'
    crops = {
        'police': ('Police Station (1).jpg', (35, 911, 753, 1577)),
        'school': ('School (3).jpg', (35, 893, 753, 1717)),
        'hospital': ('Hospital (5).jpg', (35, 841, 753, 1734)),
        'library': ('Library (4).jpg', (0, 0, 900, 471)),
        'grocery': ('Grocery Store (2).png', (0, 0, 1024, 655)),
        'gas': ('Gas Station.jpg', (461, 451, 1024, 1024)),
    }
    for k, (f, box) in crops.items():
        m['locations'][k] = save_jpg(Image.open(L / f).crop(box), f'locations/{k}.jpg', 520, 78)

    # ── 생존자 ──
    sv = {s['name_en']: s for s in d['survivors']}
    for s in my_surv:
        src = sv[s['en']]
        slug = s['id']
        portrait = circle(Image.open(SRC / src['portrait_image']), (32, 12, 288, 268), 160)
        m['survivors'][slug] = {
            'card': card(src['card_image'], f'survivors/{slug}.jpg'),
            'portrait': save_png(portrait, f'portraits/{slug}.png'),
        }

    # ── 카드 ──
    cards = d['cards']
    ko2crisis = {c['name']: c['id'] for c in my_game['crises']}
    for c in cards:
        if c['type'] == 'crisis':
            cid = ko2crisis[c['name_ko']]
            m['crises'][cid] = card(c['image'], f'crisis/{cid}.jpg')
    objko = {}
    for o in my_game['objectives']:
        for side, s in o['sides'].items():
            objko[(s.get('title') or o['name'], side)] = o['id']
            objko[(o['name'], side)] = o['id']
    for c in cards:
        if c['type'] == 'main_objective':
            side = c.get('side') or ('hard' if 'Hard' in c['deck'] else 'normal')
            oid = objko.get((c['name_ko'], side))
            if not oid:
                oid = next(v for (n, s), v in objko.items() if s == side and n.split(' ')[0] == c['name_ko'].split(' ')[0])
            m['objectives'].setdefault(oid, {})[side] = card(c['image'], f'objectives/{oid}_{side}.jpg')
    for c in cards:
        if c['type'] == 'crossroads':
            xid = ('G' if c['deck'] == 'Crossroads' else 'S') + c['no']
            m['crossroads'][xid] = card(c['image'], f'crossroads/{xid}.jpg')
    assert len(m['crossroads']) == len(my_xr)

    # ── 아이템 ── (영문 이름 → 템플릿 키)
    EN = {'FOOD 1': 'food1', 'FOOD 2': 'food2', 'FOOD 3': 'food3', 'FUEL': 'fuel', 'JUNK': 'junk', 'MEDICINE': 'medicine',
          'COLT 1911 PISTOL': 'colt', 'TIKKA T3 TACTICAL RIFLE': 'tikka', 'FN SLP SHOTGUN': 'shotgun', 'PAD LOCK': 'padlock',
          'NIGHT VISION GOGGLES': 'nvg', 'WALKIE TALKIE': 'walkie', '1 OUTSIDER': 'out1', '2 OUTSIDERS': 'out2', '3 OUTSIDERS': 'out3',
          'ROTTING FLESH': 'flesh', 'SNOW SHOES': 'snowshoes', 'HAMMER': 'hammer', 'WRENCH': 'wrench', 'SCISSORS': 'scissors',
          'MEGAPHONE': 'megaphone', 'BASEBALL BAT': 'bat', 'GUIDE TO LEADERSHIP': 'leadership', "BEGINNER'S MARTIAL ARTS": 'martial',
          '1,2,3 BARRICADES': 'barr123', 'SCHOOL BLUEPRINTS': 'bp_school', 'A JOURNEY IN JAZZERCISE': 'jazz', 'READING LAMP': 'lamp',
          'HOSPITAL BLUEPRINTS': 'bp_hospital', "SURVIVOR'S COOKBOOK": 'cookbook', 'GROCERY STORE BLUEPRINTS': 'bp_grocery',
          'POLICE STATION BLUEPRINTS': 'bp_police', 'GAS STATION BLUEPRINTS': 'bp_gas', 'LIBRARY BLUEPRINTS': 'bp_library',
          'ADRENALINE SHOT': 'adrenaline', 'MOP': 'mop', 'FLASHLIGHT': 'flashlight', 'SWITCHBLADE': 'switchblade', 'LIGHTER': 'lighter'}
    DECK = {'Starter Items': 'start', 'Police Station Items': 'police', 'Grocery Store Items': 'grocery', 'School Items': 'school',
            'Library Items': 'library', 'Hospital Items': 'hospital', 'Gas Station Items': 'gas'}
    item_cards = {}
    for c in cards:
        if c['type'] != 'item':
            continue
        dk = DECK[c['deck']]
        img = card(c['image'], f'items/{dk}_{c["no"]}.jpg')
        for _ in range(c.get('copies') or 1):
            item_cards.setdefault(dk, []).append({'t': EN[c['name_en']], 'img': img})
    # 기존 덱 구성과 장수 비교
    items = json.loads((DATA / 'items.json').read_text(encoding='utf-8'))
    for dk, comp in items['decks'].items():
        got = {}
        for x in item_cards[dk]:
            got[x['t']] = got.get(x['t'], 0) + 1
        if got != comp:
            print('⚠ 덱 구성 차이', dk, {k: (comp.get(k), got.get(k)) for k in set(comp) | set(got) if comp.get(k) != got.get(k)})
    (DATA / 'item_cards.json').write_text(json.dumps(item_cards, ensure_ascii=False, indent=0), encoding='utf-8')
    (DATA / 'images.json').write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding='utf-8')
    n = sum(1 for _ in OUT.rglob('*') if _.is_file())
    mb = sum(_.stat().st_size for _ in OUT.rglob('*') if _.is_file()) / 1e6
    print(f'완료: 이미지 {n}개, {mb:.1f} MB')


if __name__ == '__main__':
    main()
