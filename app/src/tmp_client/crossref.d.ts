import type { CrossrefData } from './shared_types';
export interface CrossrefItem {
    book: string;
    start_chapter: number;
    end_chapter: number;
    start_verse: number | null;
    end_verse: number | null;
    single_verse: boolean;
}
export declare class BookCrossref {
    _data: CrossrefData;
    constructor(data: CrossrefData);
    get_refs(chapter: number, verse: number): CrossrefItem[];
}
