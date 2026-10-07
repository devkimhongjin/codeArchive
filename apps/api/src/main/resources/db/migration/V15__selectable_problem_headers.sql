ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS copy_header_fields VARCHAR(160) NOT NULL DEFAULT 'identity,title,url,language,performance',
  ADD COLUMN IF NOT EXISTS download_header_fields VARCHAR(160) NOT NULL DEFAULT 'identity,title,url,language,performance',
  ADD COLUMN IF NOT EXISTS github_header_fields VARCHAR(160) NOT NULL DEFAULT 'identity,title,url,language,performance';
