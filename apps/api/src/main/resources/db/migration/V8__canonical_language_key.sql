ALTER TABLE solutions ADD COLUMN language_key VARCHAR(100);

UPDATE solutions
SET language_key = CASE
    WHEN LOWER(language) LIKE 'typescript%' OR LOWER(language) = 'ts' THEN 'typescript'
    WHEN LOWER(language) LIKE 'javascript%' OR LOWER(language) LIKE 'node.js%' OR LOWER(language) = 'js' THEN 'javascript'
    WHEN LOWER(language) LIKE '%python%' OR LOWER(language) LIKE '%pypy%' THEN 'python'
    WHEN LOWER(language) LIKE 'kotlin%' THEN 'kotlin'
    WHEN LOWER(language) LIKE 'java%' AND LOWER(language) NOT LIKE 'javascript%' THEN 'java'
    WHEN LOWER(language) LIKE '%c++%' OR LOWER(language) LIKE 'cpp%' OR LOWER(language) LIKE 'g++%' THEN 'cpp'
    WHEN LOWER(language) LIKE 'c#%' OR LOWER(language) LIKE 'csharp%' THEN 'csharp'
    WHEN LOWER(language) = 'c' OR LOWER(language) LIKE 'c %' OR LOWER(language) LIKE 'c1%' OR LOWER(language) LIKE 'c2%' OR LOWER(language) LIKE 'gcc%' THEN 'c'
    WHEN LOWER(language) LIKE 'go%' THEN 'go'
    WHEN LOWER(language) LIKE 'rust%' THEN 'rust'
    WHEN LOWER(language) LIKE 'ruby%' THEN 'ruby'
    WHEN LOWER(language) LIKE 'swift%' THEN 'swift'
    WHEN LOWER(language) LIKE 'scala%' THEN 'scala'
    WHEN LOWER(language) LIKE '%sql%' THEN 'sql'
    ELSE 'unknown:' || LEFT(LOWER(REPLACE(REPLACE(REPLACE(REPLACE(language, ' ', ''), '_', ''), '.', ''), '-', '')), 92)
END;

ALTER TABLE solutions ALTER COLUMN language_key SET NOT NULL;
CREATE INDEX idx_solutions_language_key ON solutions (language_key);
