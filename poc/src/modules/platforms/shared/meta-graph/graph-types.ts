// Graph API response shapes shared across Meta-family adapters (FB + IG,
// future Threads). Phase A1 of the platform refactor — these used to live
// duplicated inline in each adapter. See docs/platform-refactor.md §7.

export interface GraphPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
  previous?: string;
}

export interface GraphListResponse<T> {
  data: T[];
  paging?: GraphPaging;
}

export interface GraphInsightValue {
  value: number | Record<string, number>;
  end_time?: string;
}

export interface GraphInsight {
  name: string;
  period: string;
  values: GraphInsightValue[];
  title?: string;
  description?: string;
  id?: string;
  // v22 `total_value` shape used by IG follower_demographics and IG per-media
  // breakdown insights. Harmless on FB endpoints that never populate it.
  total_value?: {
    value?: number;
    breakdowns?: Array<{
      dimension_keys: string[];
      results: Array<{ dimension_values: string[]; value: number }>;
    }>;
  };
}
