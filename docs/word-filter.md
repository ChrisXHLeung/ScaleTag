# Server-side public text filtering

ScaleTag checks all user-created public text on the server before accepting a post or reply. Requests containing a blocked term are rejected with HTTP `400` and a field-specific user-facing error (`<Field> contains words or phrases that are not allowed in public text. Please edit it and try again.`, localized to Chinese in [`public/locale.js`](../public/locale.js)) without echoing the matched term or storing any data.

## Covered endpoints and fields

Implemented in [`src/word-filter.js`](../src/word-filter.js) and enforced in [`src/validation.js`](../src/validation.js):

| Endpoint | Public text fields checked |
| --- | --- |
| `POST /api/polls` | `title`, `description`, `signature`, each entry in `options` |
| `POST /api/tasks` | `title`, `description`, `reward`, `signature` |
| `POST /api/sales` | `title`, `description`, `pickupLocation`, `signature` |
| `POST /api/posts/:id/replies` | `name`, `message` |

Encrypted private fields (`encryptedPrivateKey`, `encryptedContact`), cryptographic keys (`authKey`, `contactPublicKey`), and image payloads (`images`) are not passed through the word filter. In replies, email/phone detection in public fields runs first so accidental contact leaks receive the contact-privacy error.

## Multilingual matching behavior

1. **Normalization.** Input text and list entries are normalized with Unicode `NFKC` and lowercased. This canonicalizes composed/decomposed accents (NFC/NFD) and folds fullwidth compatibility characters into standard characters.
2. **Generic runtime entry filtering.** Upstream wordlists in `data/ldnoobw/` are kept unmodified without maintaining a separate custom list. At load time, `isIncludedTerm` generically omits:
   - Single Han-character entries (`/^\p{Script=Han}$/u`), because Chinese text is unspaced and single-character substring matching would falsely block common benign compounds such as `牛奶`, `安全性`, `可能性`, `乳酪`, `卵石`, and `逼真`.
   - Letterless entries containing digits (`/\p{Nd}/u` without `/\p{L}/u`, which omits `13.` in `zh`), so numbered lists, quantities, and dates (for example, `13. Bring work gloves` or `Nov 13.`) are not blocked. Letter-bearing mixed terms such as `13点`, `鸡8`, `懒8`, and `2g1c` remain active.
3. **Latin and digit word boundaries.** Whenever an included list entry begins or ends with a Latin script letter or decimal digit (`[\p{Script=Latin}\p{Nd}]`), matching enforces a non-Latin/non-digit boundary on that edge (`(?<![\p{Script=Latin}\p{Nd}])` / `(?![\p{Script=Latin}\p{Nd}])`). This prevents matching Latin or digit substrings inside innocent words or numbers (for example, `ass` inside `class`, `con` inside `condition`, `cul` inside `culture`, `osti` inside `posting`, or `13点` inside `2013点`) while still catching Latin terms adjacent to Chinese characters without spaces (for example, `你好fuck世界` or `卖B`).
4. **Multi-word phrases and multi-character CJK/emoji.** Whitespace inside multi-word terms matches `\s+`. Multi-character Chinese entries (for example, `三级片`, `性交`, `奶子`, `乳交`, `王八蛋`, `傻逼`) and emoji (`🖕`) match without word-space boundaries so blocked phrases embedded in unspaced Chinese text are caught.

## Explicit coverage limitations

- **Language coverage.** Only the four bundled lists (`en`, `zh`, `fr`, `fr-CA-u-sd-caqc`) are loaded. Terms in other languages or dialects are not covered.
- **Omitted single-character Han and letterless digit entries (resulting coverage gap).** Because single Han-character entries (`性`, `奶`, `乳`, `卵`, `幹`, `爛`, `逼`, `屌`, `屄`, `柒`, `𨳒`, etc.) and letterless digit entries (`13.`) are generically omitted at load time rather than matched as substrings, **standalone single-character Chinese profanity and standalone `13.` are not automatically blocked** unless paired with a retained multi-character entry (such as `性交`, `奶子`, `乳交`, `傻逼`, `13点`).
- **Static lexical matching only.** The filter does not detect intent, context-dependent harassment, threats, spam, unlisted inflections/plurals, phonetic variants, homoglyphs (such as Cyrillic lookalikes), or obfuscations (such as `f*ck`, `sh1t`, or inserted spaces/punctuation inside a word).
- **Preserved diacritics.** Accents are canonicalized via `NFKC` rather than stripped so accented entries like `péter` (`fr`) do not falsely block common names like `Peter`. Unaccented spellings of accented entries are blocked only if listed separately.
- **Residual false-positive risks.** Standalone cross-language homographs or non-profane senses of listed words (such as French `con`, `bite`, `folle`, or English `ass`), as well as uncommon benign uses containing retained multi-character `zh` entries, are blocked when matched literally.
- **Unchecked content.** Uploaded photos, external image URLs, and end-to-end encrypted task contact fields (`encryptedContact`, which the server cannot decrypt) are not inspected.
- **No retroactive filtering.** Posts created before the filter was deployed are not scanned retroactively. Community reporting (six distinct browser cookies freeze a post) remains active alongside this filter.

## Attribution

The bundled blocklists in [`data/ldnoobw/`](../data/ldnoobw/) (`en`, `zh`, `fr`, and `fr-CA-u-sd-caqc`) are unmodified upstream files from **List of Dirty, Naughty, Obscene, and Otherwise Bad Words (LDNOOBW)**:

- **Source:** <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0) — <https://creativecommons.org/licenses/by/4.0/> (full license text in [`data/ldnoobw/LICENSE`](../data/ldnoobw/LICENSE))
- **Modifications:** The upstream files in `data/ldnoobw/` are unmodified; at runtime, ScaleTag applies `NFKC`/case normalization and script-aware boundary matching in [`src/word-filter.js`](../src/word-filter.js).
- **Disclaimer:** Per Section 5 of CC BY 4.0, the licensed wordlists are provided "AS-IS" without warranties of any kind.

ScaleTag's application source code remains licensed under the [MIT License](../LICENSE).
