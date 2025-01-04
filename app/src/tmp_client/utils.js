async function request(url) {
  const resp = await fetch(url, { mode: "cors" });
  if (resp.ok) {
    return await resp.text();
  }
  throw new Error(`${resp.status} ${resp.statusText}: ${url}`);
}
function deep_copy(source) {
  const copy = Array.isArray(source) ? [] : {};
  for (const key in source) {
    const value = source[key];
    copy[key] = typeof value === "object" && value !== null ? deep_copy(value) : value;
  }
  return copy;
}
function rm_diacritics(string) {
  return string.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}
function _fuzzy_match(input, candidate) {
  if (!input || !candidate) {
    return -Infinity;
  }
  let skipped = 0;
  let input_i = 0;
  for (let cand_i = 0; cand_i < candidate.length; cand_i++) {
    if (candidate[cand_i] === input[input_i]) {
      input_i++;
      if (input_i >= input.length) {
        return skipped * -1;
      }
    } else if (input_i === 0) {
      return -Infinity;
    } else {
      skipped++;
      if (skipped > 4) {
        return -Infinity;
      }
    }
  }
  return -Infinity;
}
function fuzzy_search(input, candidates, cand_to_str) {
  if (!input.trim()) {
    return candidates.slice();
  }
  const input_words = rm_diacritics(input).toLowerCase().trim().split(" ");
  const items = candidates.map((candidate) => {
    const cand_words = rm_diacritics(cand_to_str(candidate)).toLowerCase().trim().split(" ");
    const score = input_words.reduce((prev, item) => {
      return prev + Math.max(...cand_words.map((cand) => _fuzzy_match(item, cand)));
    }, 0);
    return { candidate, score };
  }).filter((item) => item.score > -4);
  items.sort((a, b) => b.score - a.score);
  return items.map((item) => item.candidate);
}
function escape_html(text) {
  const escapes = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return text.replace(/[&<>"']/g, (char) => escapes[char]);
}
function num_to_letters(num) {
  if (num <= 0) {
    return "";
  }
  const ascii_offset = 97;
  return num_to_letters(Math.floor((num - 1) / 26)) + String.fromCharCode((num - 1) % 26 + ascii_offset);
}
export {
  deep_copy,
  escape_html,
  fuzzy_search,
  num_to_letters,
  request,
  rm_diacritics
};
//# sourceMappingURL=utils.js.map
