import { BibleCollection } from './collection.js';
import { BookCrossref } from './crossref.js';
import type { UsageOptions, UsageConfig } from './types';
export interface BibleClientConfig {
    endpoints?: string[];
    data_endpoint?: string;
    usage?: UsageOptions;
    remember_fetches?: boolean;
}
export declare class BibleClient {
    _endpoints: string[];
    _data_endpoint: string;
    _usage: UsageConfig;
    _remember_fetches: boolean;
    _collection_promise: Promise<BibleCollection> | undefined;
    _crossref_cache: Record<string, Promise<BookCrossref>>;
    collection: BibleCollection | undefined;
    constructor(config?: BibleClientConfig);
    fetch_collection(): Promise<BibleCollection>;
    fetch_crossref(book: string, size?: 'small' | 'medium' | 'large'): Promise<BookCrossref>;
}
