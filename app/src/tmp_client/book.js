var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import { escape_html, num_to_letters } from "./utils.js";
function validate_ref(start_chapter, start_verse, end_chapter, end_verse) {
  for (const arg of [start_chapter, start_verse, end_chapter, end_verse]) {
    if (typeof arg !== "number") {
      throw new Error("Chapter/verse arguments must all be numbers");
    } else if (arg < 0) {
      throw new Error("Chapter/verse arguments cannot be negative");
    }
  }
  if (start_chapter > end_chapter || start_chapter === end_chapter && start_verse > end_verse) {
    throw new Error("Passage end is less than passage start");
  }
}
class BibleBookHtml {
  // @internal
  constructor(json, copyright) {
    // @internal
    __publicField(this, "_copyright");
    // @internal
    __publicField(this, "_html");
    this._copyright = copyright;
    this._html = JSON.parse(json);
  }
  // Get appropriate text for attribution (defaults to first license, optionally provide one)
  get_attribution(license) {
    if (!this._copyright) {
      return "";
    }
    if (!license) {
      license = this._copyright.licenses[0];
    }
    const url = this._copyright.attribution_url;
    const owner = escape_html(this._copyright.attribution);
    return `
            <p class="fb-attribution">
                <a href="${url}" target="_blank">${owner}</a>
                (<a href="${license.url}" target="_blank">${license.name}</a>)
            </p>
        `;
  }
  // @internal
  _attribution(license) {
    if (license === false) {
      return "";
    }
    return this.get_attribution(!license || license === true ? void 0 : license);
  }
  // Get the HTML for the entire book
  get_whole({ attribute } = {}) {
    return this._html.contents.flat().map((v) => v[1]).join("") + this._attribution(attribute);
  }
  // Get HTML for a specific passage
  get_passage(start_chapter, start_verse, end_chapter, end_verse, options = {}) {
    const chapters = this._get_list(start_chapter, start_verse, end_chapter, end_verse);
    if (!chapters.length) {
      return "";
    }
    let out = "";
    for (const verses_for_ch of chapters) {
      out += `<div class="fb-chapter" data-c="${verses_for_ch[0].chapter}">` + verses_for_ch[0].content[0] + verses_for_ch.map((v) => v.content[1]).join("") + verses_for_ch[verses_for_ch.length - 1].content[2] + "</div>";
    }
    return out + this._attribution(options.attribute);
  }
  // Get HTML for a specific passage specified by a PassageReference object
  get_passage_from_ref(ref, options = {}) {
    if (ref.type === "book") {
      return this.get_whole(options);
    }
    if (ref.type === "chapter" || ref.type === "range_chapters") {
      return this.get_chapters(ref.start_chapter, ref.end_chapter, options);
    }
    return this.get_passage(
      ref.start_chapter,
      ref.start_verse,
      ref.end_chapter,
      ref.end_verse,
      options
    );
  }
  // Get HTML for multiple chapters
  get_chapters(first, last, options = {}) {
    if (typeof first !== "number" || typeof last !== "number") {
      throw new Error("First/last chapters must be numbers");
    }
    return this.get_passage(first, 1, last + 1, 0, options);
  }
  // Get HTML for a single chapter
  get_chapter(chapter, options = {}) {
    return this.get_chapters(chapter, chapter, options);
  }
  // Get HTML for a single verse
  get_verse(chapter, verse, options = {}) {
    return this.get_passage(chapter, verse, chapter, verse, options);
  }
  // @internal
  _get_list(start_chapter = 1, start_verse = 1, end_chapter, end_verse) {
    if (!end_chapter) {
      end_chapter = this._html.contents.length;
      end_verse = 0;
    } else if (typeof end_verse !== "number") {
      end_chapter += 1;
      end_verse = 0;
    }
    validate_ref(start_chapter, start_verse, end_chapter, end_verse);
    const get_verses_for_ch = (chapter, start, end) => {
      var _a, _b;
      const verses2 = (_b = (_a = this._html.contents[chapter]) == null ? void 0 : _a.slice(start, end && end + 1)) != null ? _b : [];
      return verses2.map((verse, i) => {
        const verse_num = start + i;
        return {
          // Calculate an id for the verse that is reproducible and sortable
          // e.g. Psalm 119:176 = 119176 (cccvvv)
          id: chapter * 1e3 + verse_num,
          chapter,
          verse: verse_num,
          content: verse
        };
      });
    };
    const same_ch_end_verse = start_chapter === end_chapter ? end_verse : void 0;
    const verses = [get_verses_for_ch(start_chapter, start_verse, same_ch_end_verse)];
    for (let ch = start_chapter + 1; ch < end_chapter; ch++) {
      verses.push(get_verses_for_ch(ch, 1));
    }
    if (end_chapter > start_chapter) {
      verses.push(get_verses_for_ch(end_chapter, 1, end_verse));
    }
    return verses.filter((verses_for_ch) => verses_for_ch.length);
  }
  // Get HTML as an array of individual verses (each verse will be in its own paragraph)
  get_list(start_chapter, start_verse, end_chapter, end_verse) {
    return this._get_list(start_chapter, start_verse, end_chapter, end_verse).flat().map((verse) => {
      return {
        ...verse,
        content: verse.content.join("")
      };
    });
  }
  // Get HTML as an array of individual verses by passing a PassageReference object
  get_list_from_ref(ref) {
    let end_chapter = ref.end_chapter;
    let end_verse = ref.end_verse;
    if (ref.type === "book") {
      end_chapter = void 0;
      end_verse = void 0;
    } else if (ref.type === "chapter") {
      end_chapter += 1;
      end_verse = 0;
    }
    return this.get_list(ref.start_chapter, ref.start_verse, end_chapter, end_verse);
  }
}
class BibleBookUsx {
  // @internal
  constructor(usx, copyright) {
    // @internal
    __publicField(this, "_copyright");
    // @internal
    __publicField(this, "_usx");
    this._copyright = copyright;
    this._usx = usx;
  }
  // Get the USX for the entire book
  get_whole() {
    return this._usx;
  }
}
class BibleBookUsfm {
  // @internal
  constructor(usfm, copyright) {
    // @internal
    __publicField(this, "_copyright");
    // @internal
    __publicField(this, "_usfm");
    this._copyright = copyright;
    this._usfm = usfm;
  }
  // Get the USFM for the entire book
  get_whole() {
    return this._usfm;
  }
}
function txt_array_to_markdown(contents, headings = true, notes = true) {
  const footnotes = [];
  let result = contents.map((part) => {
    if (typeof part === "string") {
      return part;
    } else if (part.type === "heading" && headings) {
      return "\n" + "#".repeat(part.level) + " " + part.contents;
    } else if (part.type === "note" && notes) {
      footnotes.push(part.contents);
      const note_letter = num_to_letters(footnotes.length);
      return `[^${note_letter}]`;
    }
    return "";
  }).join("");
  if (footnotes.length) {
    result += "\n\n\n\n";
    result += footnotes.map((note, i) => `[^${num_to_letters(i + 1)}]: ${note}`).join("\n");
  }
  return result;
}
class BibleBookTxt {
  // @internal
  constructor(txt, copyright) {
    // @internal
    __publicField(this, "_copyright");
    // @internal
    __publicField(this, "_txt");
    this._copyright = copyright;
    this._txt = JSON.parse(txt);
  }
  // Get appropriate text for attribution (defaults to first license, optionally provide one)
  get_attribution(license) {
    if (!this._copyright) {
      return "";
    }
    if (!license) {
      license = this._copyright.licenses[0];
    }
    return `



[${license.name} - ${this._copyright.attribution}]`;
  }
  // @internal
  _attribution(license) {
    if (license === false) {
      return "";
    }
    return this.get_attribution(!license || license === true ? void 0 : license);
  }
  // Get the contents of entire book
  get_whole(options = {}) {
    return this.get_passage(1, 1, this._txt.contents.length, 0, options);
  }
  // Get txt for a specific passage
  get_passage(start_chapter, start_verse, end_chapter, end_verse, options = {}) {
    validate_ref(start_chapter, start_verse, end_chapter, end_verse);
    const get_verses_for_ch = (chapter, start, end) => {
      var _a, _b;
      const verses2 = (_b = (_a = this._txt.contents[chapter]) == null ? void 0 : _a.slice(start, end && end + 1)) != null ? _b : [];
      if (!options.verse_nums) {
        return verses2;
      }
      return verses2.map((verse, i) => {
        let ref = "";
        const verse_num = start + i;
        if (verse_num === 1 || start > 1 && i === 0) {
          ref += `${chapter}:`;
        }
        ref += verse_num;
        ref = `[${ref}] `;
        return [ref, ...verse];
      });
    };
    const same_ch_end_verse = start_chapter === end_chapter ? end_verse : void 0;
    const verses = get_verses_for_ch(start_chapter, start_verse, same_ch_end_verse);
    for (let ch = start_chapter + 1; ch < end_chapter; ch++) {
      verses.push(...get_verses_for_ch(ch, 1));
    }
    if (end_chapter > start_chapter) {
      verses.push(...get_verses_for_ch(end_chapter, 1, end_verse));
    }
    const result = txt_array_to_markdown(verses.flat(), options.headings, options.notes);
    return result + this._attribution(options.attribute);
  }
  // Get txt for multiple chapters
  get_chapters(first, last, options = {}) {
    if (typeof first !== "number" || typeof last !== "number") {
      throw new Error("First/last chapters must be numbers");
    }
    return this.get_passage(first, 1, last + 1, 0, options);
  }
  // Get txt for a single chapter
  get_chapter(chapter, options = {}) {
    return this.get_chapters(chapter, chapter, options);
  }
  // Get txt for a single verse
  get_verse(chapter, verse, options = {}) {
    return this.get_passage(chapter, verse, chapter, verse, options);
  }
}
export {
  BibleBookHtml,
  BibleBookTxt,
  BibleBookUsfm,
  BibleBookUsx
};
//# sourceMappingURL=book.js.map
