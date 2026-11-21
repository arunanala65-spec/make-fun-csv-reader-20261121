// A fast CSV reader that returns exactly csv-reader 1.0.0's answer for every input.
//
// The reference reads one character at a time and builds each field up a character at a time.
// This reader keeps the same policy, byte for byte, but works in chunks: it jumps from one
// delimiter to the next with indexOf (C++ speed) and slices whole fields at once, so the
// common case — a record of plain unquoted fields on one clean line — is one slice plus one
// split. Only records that hold a quote or a stray CR take the careful per-field path, and
// even there each field is read as a slice between two delimiters.
//
// The policy, as the reference states it:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside
//     it one quote, and each CRLF or lone CR inside it is read as LF; what follows its
//     closing quote, up to the next comma or line break, is appended as it stands
//     (quote_junk, when the field ends); a quote that never closes is a literal character,
//     and the text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never
//     trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records
//     after it (every record when header is false), each padded with "" (short_row, with
//     fields: its count) or cut (long_row, with extra: the cut fields) to the first record's
//     width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every
//     LF, CRLF and lone CR inside a quoted field counted), row its record's index in rows
//     (null for the header), in the order met, a field's quote_junk when the field ends and
//     a record's short_row or long_row when the record ends.

/** How a field ended: at a comma (the record goes on), at a line break or at the end. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** A line break inside a quoted field: CRLF, a lone CR or an LF, each read as one LF. */
const QUOTED_BREAK = /\r\n?|\n/;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  // The next LF at or after pos, or len: the end of the physical line pos is on. Set at each
  // record start and refreshed after a quoted field, which may span lines.
  let lineEnd = len;
  // The record being read: the line it starts on and the index in rows it takes (null: header).
  let recordLine = 1;
  let recordRow = null;

  // Result holders for readUnquoted, so no object is built per field.
  let uValue = '';
  let uEnded = END;
  let uAdded = 0;

  // Reads an unquoted field from pos, appending onto `value`. A field never crosses a line
  // break: it ends at a comma (COMMA), at the line's end (LINE_BREAK) or at the end of the
  // text (END). A CR not followed by LF inside it is dropped with a stray_cr error. Sets
  // uValue, uEnded and uAdded (the characters appended, not counting the initial value).
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const c = text.indexOf(',', pos);
      if (c !== -1 && c < lineEnd) {
        const seg = text.slice(pos, c);
        const r = seg.indexOf('\r');
        if (r === -1) {
          pos = c + 1;
          uValue = value + seg;
          uEnded = COMMA;
          uAdded = added + seg.length;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value += seg.slice(0, r);
        added += r;
        pos += r + 1;
        continue;
      }
      if (lineEnd >= len) {
        const seg = text.slice(pos, len);
        const r = seg.indexOf('\r');
        if (r !== -1) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          value += seg.slice(0, r);
          added += r;
          pos += r + 1;
          continue;
        }
        pos = len;
        uValue = value + seg;
        uEnded = END;
        uAdded = added + seg.length;
        return;
      }
      const seg = text.slice(pos, lineEnd);
      const r = seg.indexOf('\r');
      if (r !== -1 && r < seg.length - 1) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value += seg.slice(0, r);
        added += r;
        pos += r + 1;
        continue;
      }
      const crlf = seg.length > 0 && seg.charCodeAt(seg.length - 1) === 13;
      pos = lineEnd + 1;
      line += 1;
      uValue = value + (crlf ? seg.slice(0, -1) : seg);
      uEnded = LINE_BREAK;
      uAdded = added + seg.length - (crlf ? 1 : 0);
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = len;

    let fields = null;
    let quoted = false;

    // Fast path: the whole record is one clean line — no quote in it, and no CR except a
    // trailing CRLF. One slice and one split answer the whole record.
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= lineEnd) {
      const seg = text.slice(pos, lineEnd);
      const r = seg.indexOf('\r');
      if (r === -1) {
        fields = seg.split(',');
      } else if (lineEnd < len && r === seg.length - 1) {
        fields = seg.slice(0, -1).split(',');
      }
      if (fields !== null) {
        pos = lineEnd >= len ? len : lineEnd + 1;
        if (lineEnd < len) line += 1;
      }
    }

    if (fields === null) {
      fields = [];
      let fieldVal = '';
      let fieldEnded = END;
      let lastQuoted = false;
      do {
        if (text.charCodeAt(pos) === 34) {
          lastQuoted = true;
          const open = pos;
          const openLine = line;
          pos += 1;
          let val = '';
          let closed = false;
          while (pos < len) {
            const qq = text.indexOf('"', pos);
            if (qq === -1) break;
            if (qq > pos) {
              const seg = text.slice(pos, qq);
              if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
                val += seg;
              } else {
                const parts = seg.split(QUOTED_BREAK);
                line += parts.length - 1;
                val += parts.join('\n');
              }
              pos = qq;
            }
            if (text.charCodeAt(qq + 1) === 34) {
              val += '"';
              pos = qq + 2;
              continue;
            }
            pos = qq + 1;
            closed = true;
            break;
          }
          if (!closed) {
            // The quote never closes: it is a literal character, and the text after it is
            // read again as an unquoted field.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            lineEnd = text.indexOf('\n', pos);
            if (lineEnd === -1) lineEnd = len;
            readUnquoted('"');
            fieldVal = uValue;
            fieldEnded = uEnded;
          } else {
            if (line !== openLine) {
              lineEnd = text.indexOf('\n', pos);
              if (lineEnd === -1) lineEnd = len;
            }
            if (pos >= len) {
              fieldVal = val;
              fieldEnded = END;
            } else {
              const cc = text.charCodeAt(pos);
              if (cc === 44) {
                pos += 1;
                fieldVal = val;
                fieldEnded = COMMA;
              } else if (cc === 10) {
                pos += 1;
                line += 1;
                fieldVal = val;
                fieldEnded = LINE_BREAK;
              } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
                pos += 2;
                line += 1;
                fieldVal = val;
                fieldEnded = LINE_BREAK;
              } else {
                // What follows the closing quote is appended as it stands, up to the next
                // comma or line break.
                readUnquoted(val);
                if (uAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
                fieldVal = uValue;
                fieldEnded = uEnded;
              }
            }
          }
        } else {
          lastQuoted = false;
          readUnquoted('');
          fieldVal = uValue;
          fieldEnded = uEnded;
        }
        fields.push(fieldVal);
      } while (fieldEnded === COMMA);
      quoted = lastQuoted;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr
    // errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
