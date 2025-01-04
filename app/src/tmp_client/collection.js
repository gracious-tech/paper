var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import {
  book_names_english,
  books_ordered,
  PassageReference,
  detect_references,
  english_abbrev_include,
  english_abbrev_exclude,
  book_abbrev_english
} from "@gracious.tech/bible-references";
import { BibleBookHtml, BibleBookUsx, BibleBookUsfm, BibleBookTxt } from "./book.js";
import { filter_licenses } from "./licenses.js";
import { deep_copy, fuzzy_search, request } from "./utils.js";
import { TranslationExtra } from "./translation.js";
class BibleCollection {
  // @internal
  constructor(usage, remember_fetches, manifests) {
    // @internal
    __publicField(this, "_usage");
    // @internal
    __publicField(this, "_remember_fetches");
    // @internal
    __publicField(this, "_fetch_book_cache", {});
    // @internal
    __publicField(this, "_fetch_extras_cache", {});
    // @internal
    __publicField(this, "_local_book_names", {});
    // @internal
    __publicField(this, "_manifest");
    // @internal
    __publicField(this, "_endpoints", {});
    // Map translation ids to endpoints
    // @internal
    __publicField(this, "_modern_year", (/* @__PURE__ */ new Date()).getFullYear() - 70);
    this._usage = usage;
    this._remember_fetches = remember_fetches;
    this._manifest = {
      licenses: manifests[0][1].licenses,
      // Still useful even if resolved within transl.s
      languages: {},
      language2to3: {},
      // NOTE If first manifest is sparse then may not include all possible codes
      //      But this is a non-essential array just used to slightly improve sorting
      languages_most_spoken: manifests[0][1].languages_most_spoken,
      translations: {}
    };
    const languages = /* @__PURE__ */ new Set();
    for (const [endpoint, manifest] of manifests.reverse()) {
      for (const [trans, trans_data] of Object.entries(manifest.translations)) {
        let licenses = trans_data.copyright.licenses.map((item) => {
          if (typeof item.license === "string") {
            return {
              id: item.license,
              name: manifest.licenses[item.license].name,
              restrictions: manifest.licenses[item.license].restrictions,
              url: item.url
            };
          } else {
            return {
              id: null,
              name: "Custom license",
              restrictions: item.license,
              url: item.url
            };
          }
        });
        licenses = filter_licenses(licenses, this._usage);
        if (!licenses.length) {
          continue;
        }
        languages.add(trans.slice(0, 3));
        const ot = trans_data.books_ot === true ? books_ordered.slice(0, 39) : trans_data.books_ot;
        const nt = trans_data.books_nt === true ? books_ordered.slice(39) : trans_data.books_nt;
        this._manifest.translations[trans] = {
          ...trans_data,
          books_ot_list: ot,
          books_nt_list: nt,
          copyright: {
            ...trans_data.copyright,
            licenses
          }
        };
        this._endpoints[trans] = endpoint;
      }
      for (const lang in manifest.languages) {
        if (languages.has(lang)) {
          this._manifest.languages[lang] = manifest.languages[lang];
        }
      }
      for (const [lang2, lang3] of Object.entries(manifest.language2to3)) {
        if (languages.has(lang3)) {
          this._manifest.language2to3[lang2] = manifest.language2to3[lang2];
        }
      }
    }
  }
  // @internal
  _ensure_trans_exists(translation) {
    if (!this.has_translation(translation)) {
      throw new Error(`Translation with id "${translation}" does not exist in collection(s)`);
    }
  }
  // @internal
  _ensure_book_exists(translation, book) {
    this._ensure_trans_exists(translation);
    if (!books_ordered.includes(book)) {
      throw new Error(`Book id "${book}" is not valid (should be 3 letters lowercase)`);
    }
    if (!this.has_book(translation, book)) {
      throw new Error(`Translation "${translation}" does not have book "${book}"`);
    }
  }
  // Check if a language exists (must be 3 character id)
  has_language(language) {
    return language in this._manifest.languages;
  }
  // Check if a translation exists
  has_translation(translation) {
    return translation in this._manifest.translations;
  }
  // Check if a book exists within a translation
  has_book(translation, book) {
    this._ensure_trans_exists(translation);
    const trans_meta = this._manifest.translations[translation];
    return trans_meta.books_ot_list.includes(book) || trans_meta.books_nt_list.includes(book);
  }
  get_languages({ object, exclude_old, sort_by, search } = {}) {
    let list = Object.entries(this._manifest.languages).map(([code, data]) => {
      return {
        code,
        name_local: data.local,
        name_english: data.english,
        name_bilingual: data.english === data.local ? data.local : `${data.local} (${data.english})`,
        population: data.pop
      };
    });
    if (exclude_old) {
      list = list.filter((item) => item.population !== null);
    }
    if (search !== void 0) {
      list = fuzzy_search(search, list, (c) => c.name_local + " " + c.name_english);
    }
    if (object) {
      return Object.fromEntries(list.map((item) => [item.code, item]));
    }
    if (!search) {
      if (sort_by === "population_L1") {
        list.sort((a, b) => {
          var _a, _b;
          return ((_a = b.population) != null ? _a : -1) - ((_b = a.population) != null ? _b : -1);
        });
      } else if (sort_by === "population") {
        const item_to_pop = (item) => {
          var _a;
          const most_spoken_i = this._manifest.languages_most_spoken.indexOf(item.code);
          if (most_spoken_i !== -1) {
            const list_len = this._manifest.languages_most_spoken.length;
            return (list_len - most_spoken_i) * 9999999999;
          }
          return (_a = item.population) != null ? _a : -1;
        };
        list.sort((a, b) => {
          return item_to_pop(b) - item_to_pop(a);
        });
      } else {
        list.sort((a, b) => {
          const name_key = sort_by === "english" ? "name_english" : "name_local";
          return a[name_key].localeCompare(b[name_key]);
        });
      }
    }
    return list;
  }
  // Get the user's preferred available language (no arg required when used in browser)
  get_preferred_language(preferences = []) {
    var _a, _b, _c;
    if (preferences.length === 0 && typeof self !== "undefined") {
      preferences = [...(_b = self.navigator.languages) != null ? _b : [(_a = self.navigator.language) != null ? _a : "eng"]];
    }
    for (let code of preferences) {
      code = (_c = code.toLowerCase().split("-")[0]) != null ? _c : "";
      if (code in this._manifest.languages) {
        return code;
      }
      if (code in this._manifest.language2to3) {
        return this._manifest.language2to3[code];
      }
    }
    return "eng" in this._manifest.languages ? "eng" : Object.keys(this._manifest.languages)[0];
  }
  get_translations({ language, object, sort_by_year, usage, exclude_obsolete, exclude_incomplete } = {}) {
    let list = Object.entries(this._manifest.translations).map(([id, trans]) => {
      let bilingual = trans.name.local || trans.name.english;
      if (trans.name.local && trans.name.english && trans.name.local.toLowerCase() !== trans.name.english.toLowerCase()) {
        bilingual = `${trans.name.local} (${trans.name.english})`;
      }
      let bilingual_abbrev = trans.name.local_abbrev || trans.name.english_abbrev;
      if (trans.name.local_abbrev && trans.name.english_abbrev && trans.name.local_abbrev !== trans.name.english_abbrev) {
        bilingual_abbrev = `${trans.name.local_abbrev} (${trans.name.english_abbrev})`;
      }
      return {
        id,
        language: id.slice(0, 3),
        direction: trans.direction,
        year: trans.year,
        name: trans.name.local || trans.name.english,
        name_abbrev: trans.name.local_abbrev || trans.name.english_abbrev,
        name_english: trans.name.english,
        name_english_abbrev: trans.name.english_abbrev,
        name_local: trans.name.local,
        name_local_abbrev: trans.name.local_abbrev,
        name_bilingual: bilingual,
        name_bilingual_abbrev: bilingual_abbrev,
        attribution: trans.copyright.attribution,
        attribution_url: trans.copyright.attribution_url,
        licenses: deep_copy(
          filter_licenses(trans.copyright.licenses, { ...this._usage, ...usage })
        ),
        liternalness: trans.literalness,
        tags: [...trans.tags]
      };
    }).filter((trans) => trans.licenses.length);
    if (language) {
      list = list.filter((item) => item.language === language);
    }
    if (exclude_obsolete) {
      const modern = list.filter((item) => item.year >= this._modern_year);
      if (modern.length) {
        list = modern;
      }
      for (const tag of ["archaic", "questionable", "niche"]) {
        const reduced_list = list.filter((item) => !item.tags.includes(tag));
        if (reduced_list.length) {
          list = reduced_list;
        }
      }
    }
    if (exclude_incomplete) {
      list = list.filter((item) => {
        const trans_meta = this._manifest.translations[item.id];
        return trans_meta.books_ot === true && trans_meta.books_nt === true;
      });
    }
    if (object) {
      return Object.fromEntries(list.map((item) => [item.id, item]));
    }
    list.sort((a, b) => {
      return sort_by_year ? b.year - a.year : a.name_local.localeCompare(b.name_local);
    });
    return list;
  }
  // Get user's preferred available translation (provide language preferences if not in browser)
  get_preferred_translation(languages = []) {
    const language = this.get_preferred_language(languages);
    let candidate = null;
    let candidate_full = false;
    let candidate_year = -9999;
    for (const [id, data] of Object.entries(this._manifest.translations)) {
      if (id.slice(0, 3) === language) {
        if (data.tags.includes("recommended")) {
          return id;
        }
        const full = data.books_ot === true && data.books_nt === true;
        if (!candidate || !candidate_full && full || full && data.year > candidate_year) {
          candidate = id;
          candidate_year = data.year;
          candidate_full = full;
        }
      }
    }
    return candidate != null ? candidate : Object.keys(this._manifest.translations)[0];
  }
  get_books(translation, { object, sort_by_name, testament, whole } = {}) {
    let available = books_ordered;
    if (translation) {
      this._ensure_trans_exists(translation);
      const trans_meta = this._manifest.translations[translation];
      available = [...trans_meta.books_ot_list, ...trans_meta.books_nt_list];
    }
    let local = {};
    if (translation && translation in this._local_book_names) {
      local = this._local_book_names[translation];
    }
    const slice = testament ? testament === "ot" ? [0, 39] : [39] : [];
    const list = books_ordered.slice(...slice).filter((id) => whole || available.includes(id)).map((id) => {
      var _a, _b, _c, _d;
      const ot = books_ordered.indexOf(id) < 39;
      const local_name = (_a = local[id]) == null ? void 0 : _a.normal;
      let bilingual = book_names_english[id];
      if (local_name && bilingual.toLowerCase() !== local_name.toLowerCase()) {
        bilingual = `${local_name} (${bilingual})`;
      }
      const local_abbrev = (_b = local[id]) == null ? void 0 : _b.abbrev;
      let bilingual_abbrev = book_abbrev_english[id];
      if (local_abbrev && bilingual_abbrev.toLowerCase() !== local_abbrev.toLowerCase()) {
        bilingual_abbrev = `${local_abbrev} (${bilingual_abbrev})`;
      }
      return {
        id,
        name: local_name || book_names_english[id],
        name_abbrev: local_abbrev || book_abbrev_english[id],
        name_english: book_names_english[id],
        name_english_abbrev: book_abbrev_english[id],
        name_local: local_name != null ? local_name : "",
        name_local_abbrev: local_abbrev != null ? local_abbrev : "",
        name_local_long: (_d = (_c = local[id]) == null ? void 0 : _c.long) != null ? _d : "",
        name_bilingual: bilingual,
        name_bilingual_abbrev: bilingual_abbrev,
        ot,
        nt: !ot,
        available: !!translation && available.includes(id)
      };
    });
    if (object) {
      return Object.fromEntries(list.map((item) => [item.id, item]));
    }
    if (sort_by_name) {
      list.sort((a, b) => a.name_english.localeCompare(b.name_english));
    }
    return list;
  }
  // Get the URL for a book's content (useful for caching and manual retrieval)
  get_book_url(translation, book, format = "html") {
    const ext = ["html", "txt"].includes(format) ? "json" : format;
    return `${this._endpoints[translation]}bibles/${translation}/${format}/${book}.${ext}`;
  }
  // Get book ids that are available/missing for a translation for each testament
  get_completion(translation) {
    this._ensure_trans_exists(translation);
    const data = {
      nt: { available: [], missing: [] },
      ot: { available: [], missing: [] }
    };
    const trans_meta = this._manifest.translations[translation];
    const trans_books = [...trans_meta.books_ot_list, ...trans_meta.books_nt_list];
    let testament = "ot";
    for (const book of books_ordered) {
      if (book === "mat") {
        testament = "nt";
      }
      const status = trans_books.includes(book) ? "available" : "missing";
      data[testament][status].push(book);
    }
    return data;
  }
  async fetch_book(translation, book, format = "html") {
    this._ensure_book_exists(translation, book);
    const key = `${translation} ${book} ${format}`;
    if (key in this._fetch_book_cache) {
      return this._fetch_book_cache[key];
    }
    const promise = request(this.get_book_url(translation, book, format)).then((contents) => {
      const format_class = {
        html: BibleBookHtml,
        usx: BibleBookUsx,
        usfm: BibleBookUsfm,
        txt: BibleBookTxt
      }[format];
      return new format_class(contents, this._manifest.translations[translation].copyright);
    });
    if (this._remember_fetches) {
      this._fetch_book_cache[key] = promise;
      promise.catch(() => {
        delete this._fetch_book_cache[key];
      });
    }
    return promise;
  }
  // Make request for extra metadata for a translation (such as book names and section headings).
  // This will also auto-provide local book names for future calls of `get_books()`.
  async fetch_translation_extras(translation) {
    this._ensure_trans_exists(translation);
    if (translation in this._fetch_extras_cache) {
      return this._fetch_extras_cache[translation];
    }
    const url = `${this._endpoints[translation]}bibles/${translation}/extra.json`;
    const promise = request(url).then((contents) => {
      const data = JSON.parse(contents);
      this._local_book_names[translation] = data.book_names;
      return new TranslationExtra(data);
    });
    if (this._remember_fetches) {
      this._fetch_extras_cache[translation] = promise;
      promise.catch(() => {
        delete this._fetch_book_cache[translation];
      });
    }
    return promise;
  }
  // @internal Auto-prepare args for from_string/detect_references based on translation
  _from_string_args(translation = [], always_detect_english = true) {
    var _a, _b, _c;
    const book_names = [];
    const translations = typeof translation === "string" ? [translation] : translation;
    for (const trans of translations) {
      for (const [code, name_types] of Object.entries((_a = this._local_book_names[trans]) != null ? _a : {})) {
        if (name_types.normal) {
          book_names.push([code, name_types.normal]);
        }
        if (name_types.abbrev) {
          book_names.push([code, name_types.abbrev]);
        }
      }
    }
    if (always_detect_english) {
      for (const [code, name] of Object.entries(book_names_english)) {
        book_names.push([code, name]);
      }
      for (const [code, name] of english_abbrev_include) {
        book_names.push([code, name]);
      }
    }
    const chinese_like = [
      "zho",
      // Chinese macrolanguage group
      "lzh",
      "gan",
      "hak",
      "czh",
      "cjy",
      "cmn",
      "mnp",
      "cdo",
      // Part of 'zho' group
      "nan",
      "czo",
      "cnp",
      "cpx",
      "csp",
      "wuu",
      "hsn",
      "yue",
      // Part of 'zho' group
      "jpn",
      // Japanese
      "kor"
      // Korean
    ];
    const lang = (_c = (_b = translations[0]) == null ? void 0 : _b.split("_")[0]) != null ? _c : "eng";
    const exclude_book_names = lang === "eng" ? [...english_abbrev_exclude] : [];
    const min_chars = chinese_like.includes(lang) ? 1 : 2;
    const match_from_start = !chinese_like.includes(lang);
    return [
      book_names,
      exclude_book_names,
      min_chars,
      match_from_start
    ];
  }
  // Detect bible references in a block of text using book names of given translation(s).
  // A generator is returned and can be passed updated text each time it yields a result.
  // You must have first awaited a call to `fetch_translation_extras()` to be able to parse
  //     non-English references.
  detect_references(text, translation = [], always_detect_english = true) {
    return detect_references(
      text,
      ...this._from_string_args(translation, always_detect_english)
    );
  }
  // Parse a single bible reference string into a PassageReference object (validating it).
  // Supports only single passages (for e.g. Matt 10:6,8 use `detect_references`).
  // You must have first awaited a call to `fetch_translation_extras()` to be able to parse
  //     non-English references.
  string_to_reference(text, translation = [], always_detect_english = true) {
    return PassageReference.from_string(
      text,
      ...this._from_string_args(translation, always_detect_english)
    );
  }
  // Render a PassageReference object as a string using the given translation's book names.
  // You must have first awaited a call to `fetch_translation_extras()` for the translation,
  // or English will be used by default.
  reference_to_string(reference, translation, abbreviate) {
    var _a;
    const book_names = { ...abbreviate ? book_abbrev_english : book_names_english };
    if (translation) {
      const name_prop = abbreviate ? "abbrev" : "normal";
      for (const [book, props] of Object.entries((_a = this._local_book_names[translation]) != null ? _a : {})) {
        if (props[name_prop]) {
          book_names[book] = props[name_prop];
        }
      }
    }
    return reference.toString(book_names);
  }
}
export {
  BibleCollection
};
//# sourceMappingURL=collection.js.map
