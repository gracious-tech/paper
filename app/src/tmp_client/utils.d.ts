export declare function request(url: string): Promise<string>;
export declare function deep_copy<T extends object>(source: T): T;
export declare function rm_diacritics(string: string): string;
export declare function fuzzy_search<T>(input: string, candidates: T[], cand_to_str: (c: T) => string): T[];
export declare function escape_html(text: string): string;
export declare function num_to_letters(num: number): string;
