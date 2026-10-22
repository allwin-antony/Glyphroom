export const MARK_STRONG = 'strong' as const;
export const MARK_EM = 'em' as const;
export const MARK_LINK = 'link' as const;
export const MARK_CODE = 'code' as const;
export const MARK_SUGGESTION_INSERT = 'suggestion_insert' as const;
export const MARK_SUGGESTION_DELETE = 'suggestion_delete' as const;
export const MARK_ATTRIBUTION = 'attribution' as const;

export type StandardMarkType = 
  | typeof MARK_STRONG 
  | typeof MARK_EM 
  | typeof MARK_LINK 
  | typeof MARK_CODE;

export type SuggestionMarkType = 
  | typeof MARK_SUGGESTION_INSERT 
  | typeof MARK_SUGGESTION_DELETE;

export type AllMarkTypes = StandardMarkType | SuggestionMarkType | typeof MARK_ATTRIBUTION;
