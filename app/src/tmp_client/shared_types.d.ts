export type OneOrMore<T> = [T, ...T[]];
export interface MetaLanguage {
    local: string;
    english: string;
    pop: number | null;
}
export interface MetaTranslationName {
    local: string;
    local_abbrev: string;
    english: string;
    english_abbrev: string;
}
export interface MetaRestrictions {
    forbid_limitless: boolean;
    forbid_commercial: boolean;
    forbid_derivatives: boolean | 'same-license';
    forbid_attributionless: boolean;
    forbid_other: boolean;
}
export interface MetaStandardLicense {
    name: string;
    restrictions: MetaRestrictions;
}
export interface MetaCopyright {
    attribution: string;
    attribution_url: string;
    licenses: {
        license: string | MetaRestrictions;
        url: string;
    }[];
}
export interface DistManifestItem {
    name: MetaTranslationName;
    year: number;
    direction: 'ltr' | 'rtl';
    copyright: MetaCopyright;
}
export type TranslationLiteralness = 1 | 2 | 3 | 4 | 5 | null;
export type TranslationTag = 'recommended' | 'archaic' | 'questionable' | 'niche';
export interface DistTranslation extends DistManifestItem {
    literalness: TranslationLiteralness;
    tags: TranslationTag[];
    books_ot: true | string[];
    books_nt: true | string[];
}
export interface DistManifest {
    translations: Record<string, DistTranslation>;
    languages: Record<string, MetaLanguage>;
    language2to3: Record<string, string>;
    languages_most_spoken: string[];
    books_ordered: string[];
    book_names_english: Record<string, string>;
    licenses: Record<string, MetaStandardLicense>;
}
export interface BookSection {
    start_chapter: number;
    start_verse: number;
    end_chapter: number;
    end_verse: number;
    heading: string | null;
}
export interface DistTranslationExtra {
    book_names: Record<string, BookNames>;
    chapter_headings: Record<string, string[]>;
    sections: Record<string, BookSection[]>;
}
export interface DistNotes extends DistManifestItem {
    books: string[];
}
export interface DistNotesManifest {
    notes: Record<string, DistNotes>;
}
export interface BookNames {
    normal: string;
    long: string;
    abbrev: string;
}
export interface BibleJsonHtml {
    book: string;
    name: BookNames;
    contents: string[][][];
}
export interface TxtHeading {
    type: 'heading';
    contents: string;
    level: 1 | 2 | 3;
}
export interface TxtNote {
    type: 'note';
    contents: string;
}
export type TxtContent = string | TxtHeading | TxtNote;
export interface BibleJsonTxt {
    book: string;
    name: BookNames;
    contents: TxtContent[][][];
}
export type CrossrefSingle = [string, number, number];
export type CrossrefRange = [...CrossrefSingle, number, number];
export type CrossrefData = Record<string, Record<string, (CrossrefSingle | CrossrefRange)[]>>;
