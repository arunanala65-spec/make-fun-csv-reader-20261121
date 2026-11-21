# make-fun-csv-reader-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/arunanala65-spec/make-fun-csv-reader-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/arunanala65-spec/make-fun-csv-reader-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: it answers exactly as csv-reader does on every case — broken rows, stray CRs, unterminated quotes, quote junk and all — by reading each record in indexOf-driven chunks instead of one character at a time. On the practice set it runs about 5–7x faster than the house baseline.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `$MAKEFUN_INPUT_DIR/cases.json` (default `/input`) and writes the answers to `$MAKEFUN_OUTPUT_DIR/answers.json` (default `/output`). `solve.js` is the drop-in itself: its `run(input)` returns csv-reader 1.0.0's `{columns, rows, errors}` answer for one case's `{text, header}` input.

## How it works

- A record of plain unquoted fields on one clean line is answered by one slice plus one `split(',')`.
- Any other record is parsed field by field, each field read as a slice between two delimiters found with `indexOf`, so a quoted field costs one `indexOf` for its closing quote and one slice, and an unquoted field costs one `indexOf` for its comma.
- A quote that never closes is read again as an unquoted field starting with the literal quote; a CR not followed by LF is dropped with a `stray_cr` error; what follows a closing quote is appended as it stands, with a `quote_junk` error when it adds characters. Short and long rows are padded or cut to the first record's width, with the matching error, exactly as the reference does.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ce51ph37&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
