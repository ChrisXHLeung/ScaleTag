import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  SUPPORTED_LANGUAGES,
  htmlLangFor,
  intlLocaleFor,
  languageFor,
  serverErrors,
  translate,
  translateError,
} from '../public/locale.js';
import {
  TRANSLATIONS,
  DYNAMIC_TRANSLATIONS,
  SERVER_ERRORS,
  FIELD_NAMES,
} from '../public/locale-translations.js';
import { STATIC_ASSETS } from '../src/pwa.js';

function extractStaticCalls(publicDir) {
  const keys = new Map();
  const files = readdirSync(publicDir)
    .filter(name => name.endsWith('.js') && name !== 'locale-translations.js')
    .sort();
  for (const file of files) {
    const src = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    const regex = /(?<![A-Za-z0-9_$.])t\s*\(/g;
    let match;
    while ((match = regex.exec(src))) {
      let i = match.index + match[0].length;
      let depth = 1;
      let inStr = null;
      let esc = false;
      let argStart = i;
      let tmplDepth = 0;
      const args = [];
      for (; i < src.length && depth > 0; i++) {
        const ch = src[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (inStr) {
          if (ch === '\\') {
            esc = true;
            continue;
          }
          if (inStr === '`' && ch === '$' && src[i + 1] === '{') {
            tmplDepth++;
            i++;
            continue;
          }
          if (inStr === '`' && tmplDepth > 0 && ch === '}') {
            tmplDepth--;
            continue;
          }
          if (ch === inStr && tmplDepth === 0) inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
          continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) args.push(src.slice(argStart, i).trim());
        } else if (ch === ',' && depth === 1) {
          args.push(src.slice(argStart, i).trim());
          argStart = i + 1;
        }
      }
      while (args.length && args[args.length - 1] === '') args.pop();
      if (args.length !== 2) continue;
      const [enExpr, zhExpr] = args;
      if (enExpr.includes('${')) continue;
      let enVal;
      try {
        enVal = Function(`return (${enExpr})`)();
      } catch {
        continue;
      }
      if (typeof enVal === 'string' && !keys.has(enVal)) {
        keys.set(enVal, { file, zhExpr });
      }
    }
  }
  return keys;
}

test('languageFor selects en, zh, ja, ko, fr from browser preferred languages and falls back to en', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'zh', 'ja', 'ko', 'fr']);
  assert.equal(languageFor(['zh-CN', 'en-US']), 'zh');
  assert.equal(languageFor(['zh-TW']), 'zh');
  assert.equal(languageFor(['ZH-hk']), 'zh');
  assert.equal(languageFor(['ja']), 'ja');
  assert.equal(languageFor(['ja-JP', 'en-US']), 'ja');
  assert.equal(languageFor(['JA-jp']), 'ja');
  assert.equal(languageFor(['ko']), 'ko');
  assert.equal(languageFor(['ko-KR', 'en-US']), 'ko');
  assert.equal(languageFor(['KO']), 'ko');
  assert.equal(languageFor(['fr']), 'fr');
  assert.equal(languageFor(['fr-FR', 'en-US']), 'fr');
  assert.equal(languageFor(['fr-CA']), 'fr');
  assert.equal(languageFor(['FR-ca']), 'fr');
  assert.equal(languageFor(['en-US', 'zh-CN']), 'en');
  assert.equal(languageFor(['en-US', 'ja-JP']), 'en');
  assert.equal(languageFor(['de-DE', 'fr-FR']), 'en');
  assert.equal(languageFor(['es-ES']), 'en');
  assert.equal(languageFor(['']), 'en');
  assert.equal(languageFor([]), 'en');
});

test('htmlLangFor and intlLocaleFor map all 5 languages accurately', () => {
  assert.equal(htmlLangFor('en'), 'en');
  assert.equal(htmlLangFor('zh'), 'zh-Hans');
  assert.equal(htmlLangFor('ja'), 'ja');
  assert.equal(htmlLangFor('ko'), 'ko');
  assert.equal(htmlLangFor('fr'), 'fr');
  assert.equal(htmlLangFor('xx'), 'en');

  assert.equal(intlLocaleFor('en'), 'en');
  assert.equal(intlLocaleFor('zh'), 'zh-CN');
  assert.equal(intlLocaleFor('ja'), 'ja-JP');
  assert.equal(intlLocaleFor('ko'), 'ko-KR');
  assert.equal(intlLocaleFor('fr'), 'fr-FR');
  assert.equal(intlLocaleFor('xx'), 'en');
});

test('translate handles static and dynamic strings for en, zh, ja, ko, fr', () => {
  assert.equal(translate('en', 'Create a poll', '创建投票'), 'Create a poll');
  assert.equal(translate('zh', 'Create a poll', '创建投票'), '创建投票');
  assert.equal(translate('ja', 'Create a poll', '创建投票'), '投票を作成');
  assert.equal(translate('ko', 'Create a poll', '创建投票'), '투표 만들기');
  assert.equal(translate('fr', 'Create a poll', '创建投票'), 'Créer un sondage');

  const dynamicSamples = [
    ['Option 3', '选项 3', { ja: '選択肢 3', ko: '선택지 3', fr: 'Option 3' }],
    ['Remove option 2', '删除选项 2', { ja: '選択肢 2 を削除', ko: '선택지 2 삭제', fr: 'Supprimer l’option 2' }],
    ['Show 1 external image', '显示 1 张外部图片', { ja: '1 件の外部画像を表示', ko: '외부 이미지 1장 표시', fr: 'Afficher 1 image externe' }],
    ['Show 2 external images', '显示 2 张外部图片', { ja: '2 件の外部画像を表示', ko: '외부 이미지 2장 표시', fr: 'Afficher 2 images externes' }],
    ['Poll illustration 1', '投票图片 1', { ja: '投票画像 1', ko: '투표 이미지 1', fr: 'Image du sondage 1' }],
    ['Image 2 is unavailable from its host.', '图片 2 无法从来源加载。', { ja: '画像 2 を配信元から読み込めませんでした。', ko: '이미지 2을(를) 호스트에서 불러올 수 없습니다.', fr: 'L’image 2 est indisponible depuis son serveur.' }],
    ['1 vote', '1 票', { ja: '1 票', ko: '1표', fr: '1 vote' }],
    ['1\u202f000 votes', '1,000 票', { ja: '1\u202f000 票', ko: '1\u202f000표', fr: '1\u202f000 votes' }],
    ['10 of 20 matching mapped posts', '显示 10 / 20 条符合条件的地图帖子', { ja: '一致するマップ投稿 20 件中 10 件を表示', ko: '일치하는 지도 게시물 20개 중 10개 표시', fr: '10 sur 20 publications sur carte' }],
    ['1\u202f000 of 1\u202f200 matching mapped posts · Newest 1,000 only', '显示 1,000 / 1,200 条符合条件的地图帖子 · 仅显示最新 1,000 条', { ja: '一致するマップ投稿 1\u202f200 件中 1\u202f000 件を表示 · 最新 1,000 件のみ', ko: '일치하는 지도 게시물 1\u202f200개 중 1\u202f000개 표시 · 최신 1,000개만 표시', fr: '1\u202f000 sur 1\u202f200 publications sur carte · 1 000 plus récentes uniquement' }],
    ['5 likes · 3 replies', '5 次赞 · 3 条回复', { ja: 'いいね 5 · 返信 3', ko: '좋아요 5 · 댓글 3', fr: '5 J’aime · 3 réponses' }],
    ['7 likes', '7 次赞', { ja: 'いいね 7', ko: '좋아요 7', fr: '7 J’aime' }],
    ['1 post shown', '显示 1 条帖子', { ja: '1 件の投稿を表示中', ko: '1개 게시물 표시 중', fr: '1 publication affichée' }],
    ['1\u202f000 posts shown', '显示 1,000 条帖子', { ja: '1\u202f000 件の投稿を表示中', ko: '1\u202f000개 게시물 표시 중', fr: '1\u202f000 publications affichées' }],
    ['2d 5h left', '剩余 2 天 5 小时', { ja: '残り 2日 5時間', ko: '2일 5시간 남음', fr: '2 j 5 h restantes' }],
    ['3h 15m left', '剩余 3 小时 15 分钟', { ja: '残り 3時間 15分', ko: '3시간 15분 남음', fr: '3 h 15 min restantes' }],
    ['1m left', '剩余 1 分钟', { ja: '残り 1分', ko: '1분 남음', fr: '1 min restante' }],
    ['12m left', '剩余 12 分钟', { ja: '残り 12分', ko: '12분 남음', fr: '12 min restantes' }],
    ['photo.jpg: the original photo exceeds 1 MiB. Choose a smaller original.', 'photo.jpg：原图超过 1 MiB，请选择较小的原图。', { ja: 'photo.jpg：元の写真が 1 MiB を超えています。より小さい画像をお選びください。', ko: 'photo.jpg: 원본 사진이 1 MiB를 초과합니다. 더 작은 원본을 선택하세요.', fr: 'photo.jpg : la photo originale dépasse 1 Mio. Choisissez un fichier plus petit.' }],
    ['doc.pdf: choose a JPEG, PNG or WebP photo.', 'doc.pdf：请选择 JPEG、PNG 或 WebP 照片。', { ja: 'doc.pdf：JPEG、PNG、または WebP 形式の写真を選択してください。', ko: 'doc.pdf: JPEG, PNG 또는 WebP 사진을 선택하세요.', fr: 'doc.pdf : choisissez une photo JPEG, PNG ou WebP.' }],
    ['Poll photo 1', '投票照片 1', { ja: '投票の写真 1', ko: '투표 사진 1', fr: 'Photo du sondage 1' }],
    ['Task photo 2', '任务照片 2', { ja: 'タスクの写真 2', ko: '작업 사진 2', fr: 'Photo de la tâche 2' }],
    ['Item photo 1', '物品照片 1', { ja: '品物の写真 1', ko: '물품 사진 1', fr: 'Photo de l’objet 1' }],
    ['Photo 1', '照片 1', { ja: '写真 1', ko: '사진 1', fr: 'Photo 1' }],
    ['Management URL: https://example.com/m\nManagement password: secret', '管理网址：https://example.com/m\n管理密码：secret', { ja: '管理用URL: https://example.com/m\n管理パスワード: secret', ko: '관리 URL: https://example.com/m\n관리 비밀번호: secret', fr: 'URL de gestion : https://example.com/m\nMot de passe de gestion : secret' }],
    ['Task · Reward: Coffee · View task ↗', '任务 · 酬谢：Coffee · 查看任务 ↗', { ja: 'タスク · お礼: Coffee · 詳細を見る ↗', ko: '작업 · 보상: Coffee · 작업 보기 ↗', fr: 'Tâche · Récompense : Coffee · Voir la tâche ↗' }],
    ['Open · 12 votes · View poll ↗', '进行中 · 12 票 · 查看投票 ↗', { ja: '受付中 · 12 票 · 投票を見る ↗', ko: '진행 중 · 12표 · 투표 보기 ↗', fr: 'Ouvert · 12 votes · Voir le sondage ↗' }],
    ['Ended · 1 votes · View poll ↗', '已结束 · 1 票 · 查看投票 ↗', { ja: '終了 · 1 票 · 投票を見る ↗', ko: '종료됨 · 1표 · 투표 보기 ↗', fr: 'Terminé · 1 vote · Voir le sondage ↗' }],
    ['+ 1 more option', '+ 另有 1 个选项', { ja: '+ 他 1 件の選択肢', ko: '+ 추가 선택지 1개', fr: '+ 1 autre option' }],
    ['+ 3 more options', '+ 另有 3 个选项', { ja: '+ 他 3 件の選択肢', ko: '+ 추가 선택지 3개', fr: '+ 3 autres options' }],
    ['1 reply', '1 条回复', { ja: '1 件の返信', ko: '댓글 1개', fr: '1 réponse' }],
    ['4 replies', '4 条回复', { ja: '4 件の返信', ko: '댓글 4개', fr: '4 réponses' }],
    ['This task is completed. It no longer accepts new replies.', '此任务已完成，不再接受新回复。', { ja: 'このタスクは完了済みです。新しい返信は受け付けていません。', ko: '이 작업은 완료되었습니다. 더 이상 새 댓글을 받지 않습니다.', fr: 'Cette tâche est terminée. Elle n’accepte plus de nouvelles réponses.' }],
    ['This task is closed. It no longer accepts new replies.', '此任务已关闭，不再接受新回复。', { ja: 'このタスクは終了です。新しい返信は受け付けていません。', ko: '이 작업은 종료되었습니다. 더 이상 새 댓글을 받지 않습니다.', fr: 'Cette tâche est fermée. Elle n’accepte plus de nouvelles réponses.' }],
    ['Mark this task as 完了? New replies will stop and this cannot be undone.', '确定将任务标记为已完成？这将停止新回复且无法撤销。', { ja: 'このタスクを「完了」にしますか？新規の返信は停止され、元に戻すことはできません。', ko: '이 작업을 ‘完了’ 상태로 변경하시겠습니까? 새 댓글이 중단되며 되돌릴 수 없습니다.', fr: 'Marquer cette tâche comme « 完了 » ? Les nouvelles réponses seront arrêtées et cette action est irréversible.' }],
    ['Task marked 完了.', '任务已标记为已完成。', { ja: 'タスクを「完了」にしました。', ko: '작업 상태가 ‘完了’(으)로 변경되었습니다.', fr: 'Tâche marquée comme « 完了 ».' }],
  ];
  for (const [en, zh, expected] of dynamicSamples) {
    assert.equal(translate('en', en, zh), en);
    assert.equal(translate('zh', en, zh), zh);
    for (const lang of ['ja', 'ko', 'fr']) {
      assert.equal(translate(lang, en, zh), expected[lang], `dynamic ${lang}: ${en}`);
    }
  }
  assert.ok(DYNAMIC_TRANSLATIONS.length >= 24);
});

test('100% of static t() strings across public/*.js have ja, ko, and fr translations without direct zh checks', () => {
  const publicDir = new URL('../public/', import.meta.url);
  const keys = extractStaticCalls(publicDir);
  assert.ok(keys.size >= 500, `expected at least 500 static t() keys, found ${keys.size}`);

  for (const [enKey, meta] of keys) {
    assert.ok(
      Object.hasOwn(TRANSLATIONS, enKey),
      `Missing TRANSLATIONS entry for ${JSON.stringify(enKey)} (from ${meta.file})`,
    );
    const entry = TRANSLATIONS[enKey];
    for (const lang of ['ja', 'ko', 'fr']) {
      assert.equal(typeof entry[lang], 'string', `Missing ${lang} string for ${JSON.stringify(enKey)}`);
      assert.ok(entry[lang].trim().length > 0, `Empty ${lang} string for ${JSON.stringify(enKey)}`);
      if (enKey.includes('<br>')) {
        assert.ok(entry[lang].includes('<br>'), `Missing <br> in ${lang} translation of ${JSON.stringify(enKey)}`);
      }
      if (enKey.includes('<em>')) {
        assert.ok(
          entry[lang].includes('<em>') && entry[lang].includes('</em>'),
          `Missing <em>...</em> in ${lang} translation of ${JSON.stringify(enKey)}`,
        );
      }
    }
  }

  const publicFiles = readdirSync(publicDir).filter(name => name.endsWith('.js') && name !== 'locale.js');
  for (const file of publicFiles) {
    const src = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.equal(
      /\blanguage\s*[!=]==\s*['"]zh['"]/.test(src),
      false,
      `Found direct language === 'zh' check in public/${file}`,
    );
  }
});

test('100% of serverErrors and dynamic error patterns translate across all supported languages', () => {
  const errorKeys = Object.keys(serverErrors);
  assert.ok(errorKeys.length >= 50);

  for (const key of errorKeys) {
    assert.ok(Object.hasOwn(SERVER_ERRORS, key), `Missing SERVER_ERRORS entry for ${JSON.stringify(key)}`);
    assert.equal(translateError(key, 'zh'), serverErrors[key]);
    for (const lang of ['ja', 'ko', 'fr']) {
      const value = SERVER_ERRORS[key][lang];
      assert.equal(typeof value, 'string', `Missing ${lang} error translation for ${JSON.stringify(key)}`);
      assert.ok(value.trim().length > 0, `Empty ${lang} error translation for ${JSON.stringify(key)}`);
      assert.notEqual(value, key, `${lang} error translation matches English for ${JSON.stringify(key)}`);
      assert.equal(translateError(key, lang), value);
    }
  }

  // English listing terminology preserved
  assert.equal(translateError('Sale not found.'), 'Sale listing not found.');
  assert.equal(translateError('This management link is invalid for this sale.'), 'This management link is invalid for this listing.');
  assert.equal(translateError('Replies are available on tasks and sales only.'), 'Replies are available on tasks and sale listings only.');

  // Dynamic error patterns across all 13 fields and 4 non-English languages
  const allFields = Object.keys(FIELD_NAMES);
  assert.equal(allFields.length, 13);
  for (const field of allFields) {
    for (const lang of ['zh', 'ja', 'ko', 'fr']) {
      const fieldName = FIELD_NAMES[field][lang];
      assert.ok(fieldName && fieldName.trim().length > 0, `Missing FIELD_NAMES[${field}][${lang}]`);
      const maxErr = translateError(`${field} is required and must be at most 140 characters.`, lang);
      assert.ok(maxErr.includes(fieldName) && maxErr.includes('140'), `max length translation failed for ${field}/${lang}: ${maxErr}`);
      const optMaxErr = translateError(`${field} must be at most 60 characters.`, lang);
      assert.ok(optMaxErr.includes(fieldName) && optMaxErr.includes('60'), `optional max length translation failed for ${field}/${lang}: ${optMaxErr}`);
    }
  }
  const blockedFields = ['Title', 'Description', 'Signature', 'Option', 'Reward', 'Reply', 'Name', 'Pickup location'];
  for (const field of blockedFields) {
    for (const lang of ['zh', 'ja', 'ko', 'fr']) {
      const msg = translateError(`${field} contains words or phrases that are not allowed in public text. Please edit it and try again.`, lang);
      assert.ok(msg.includes(FIELD_NAMES[field][lang]), `blocked translation failed for ${field}/${lang}: ${msg}`);
      assert.notEqual(msg, `${field} contains words or phrases that are not allowed in public text. Please edit it and try again.`);
    }
  }
  for (const state of ['completed', 'closed']) {
    for (const lang of ['zh', 'ja', 'ko', 'fr']) {
      const replyErr = translateError(`This task is ${state} and no longer accepts replies.`, lang);
      const stateErr = translateError(`This task is already ${state}. Its status can no longer change.`, lang);
      assert.notEqual(replyErr, `This task is ${state} and no longer accepts replies.`);
      assert.notEqual(stateErr, `This task is already ${state}. Its status can no longer change.`);
    }
  }
});

test('PWA static allowlist precaches /locale-translations.js', () => {
  assert.ok(STATIC_ASSETS.includes('/locale.js'));
  assert.ok(STATIC_ASSETS.includes('/locale-translations.js'));
});
