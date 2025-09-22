export interface GraphErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
    is_transient?: boolean;
  };
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MeResponse {
  id: string;
  name: string;
}

export interface AccountsResponse {
  data: Array<{
    id: string;
    name: string;
    access_token: string;
  }>;
}

export interface DebugTokenResponse {
  data: {
    app_id: string;
    application: string;
    expires_at: number;
    is_valid: boolean;
    scopes: string[];
    type: string;
    user_id: string;
  };
}

export interface CreatePostResponse {
  id: string;
}

export interface PhotoUploadResponse {
  id: string;
  post_id?: string;
}

export interface FeedAttachment {
  description?: string;
  media?: {
    image?: {
      src?: string;
      width?: number;
      height?: number;
    };
  };
  target?: {
    id?: string;
    url?: string;
  };
  title?: string;
  type?: string;
  url?: string;
}

export interface FeedItem {
  id: string;
  message?: string;
  story?: string;
  status_type?: string;
  created_time: string;
  permalink_url?: string;
  attachments?: {
    data?: FeedAttachment[];
  };
}

export interface FeedResponse {
  data: FeedItem[];
  paging?: {
    previous?: string;
    next?: string;
    cursors?: {
      before?: string;
      after?: string;
    };
  };
}
