-- Import only the known pre-rebuild public schema.  This migration runs in a
-- single Flyway transaction, so an unexpected source shape cannot leave a
-- partial copy in codearchive_v2.
DO $$
DECLARE
    users_exists boolean := to_regclass('public.users') IS NOT NULL;
    solutions_exists boolean := to_regclass('public.solutions') IS NOT NULL;
    legacy_users boolean;
    legacy_solutions boolean;
    rebuilt_users boolean;
    rebuilt_solutions boolean;
BEGIN
    IF NOT users_exists AND NOT solutions_exists THEN
        RETURN;
    END IF;

    SELECT
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users'
                  AND column_name = 'id' AND udt_name = 'uuid')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'github_user_id' AND udt_name = 'int8')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'github_login' AND data_type = 'character varying')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'display_name' AND data_type = 'character varying')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'created_at' AND data_type = 'timestamp with time zone')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'updated_at' AND data_type = 'timestamp with time zone'),
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users'
                  AND column_name = 'id' AND udt_name = 'int8')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                      AND column_name = 'github_id')
    INTO legacy_users, rebuilt_users;

    SELECT
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'solutions'
                  AND column_name = 'id' AND udt_name = 'uuid')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'user_id' AND udt_name = 'uuid')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'client_record_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'platform')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'problem_number')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'title')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'language')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'code')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'result')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'observed_at' AND data_type = 'timestamp with time zone')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'solved_at' AND data_type = 'timestamp with time zone')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'execution_time')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'memory_usage'),
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'solutions'
                  AND column_name = 'id' AND udt_name = 'int8')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'solutions'
                      AND column_name = 'capture_id')
    INTO legacy_solutions, rebuilt_solutions;

    IF rebuilt_users AND rebuilt_solutions THEN
        RETURN;
    END IF;
    IF NOT (legacy_users AND legacy_solutions) THEN
        RAISE EXCEPTION 'public schema is neither the recognized legacy CodeArchive shape nor the rebuilt shape';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.github_user_id IS NULL OR u.github_login IS NULL OR btrim(u.github_login) = ''
    ) OR EXISTS (
        SELECT 1
        FROM public.solutions s
        LEFT JOIN public.users u ON u.id = s.user_id
        WHERE u.id IS NULL
           OR s.client_record_id IS NULL OR char_length(s.client_record_id) <> 36
           OR s.platform NOT IN ('SWEA', 'PROGRAMMERS')
           OR s.problem_number IS NULL OR s.title IS NULL OR s.language IS NULL OR s.code IS NULL
           OR s.result <> 'ACCEPTED' OR s.observed_at IS NULL OR s.solved_at IS NULL
    ) OR EXISTS (
        SELECT 1 FROM public.solutions
        GROUP BY user_id, client_record_id HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'recognized legacy CodeArchive rows violate the import contract';
    END IF;

    INSERT INTO users (email, password_hash, github_id, github_login, github_name, github_email, created_at)
    SELECT NULL, NULL, u.github_user_id::text, u.github_login, u.display_name, NULL, u.created_at
    FROM public.users u
    ON CONFLICT (github_id) DO NOTHING;

    INSERT INTO solutions (
        user_id, capture_id, platform, problem_number, title, problem_url, language,
        source_code, result, observed_at, solved_at, execution_time, memory_usage
    )
    SELECT
        target_user.id,
        s.client_record_id,
        s.platform,
        s.problem_number,
        s.title,
        CASE s.platform
            WHEN 'PROGRAMMERS' THEN 'https://school.programmers.co.kr/learn/courses/30/lessons/' || s.problem_number
            ELSE 'https://swexpertacademy.com/main/code/problem/problemList.do'
        END,
        s.language,
        s.code,
        s.result,
        s.observed_at,
        s.solved_at,
        CASE
            WHEN NULLIF(regexp_replace(coalesce(s.execution_time::text, ''), '[^0-9.]', '', 'g'), '') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN NULLIF(regexp_replace(s.execution_time::text, '[^0-9.]', '', 'g'), '')::numeric(19, 6)
            ELSE NULL
        END,
        CASE
            WHEN NULLIF(regexp_replace(coalesce(s.memory_usage::text, ''), '[^0-9.]', '', 'g'), '') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN NULLIF(regexp_replace(s.memory_usage::text, '[^0-9.]', '', 'g'), '')::numeric(19, 6)
            ELSE NULL
        END
    FROM public.solutions s
    JOIN public.users legacy_user ON legacy_user.id = s.user_id
    JOIN users target_user ON target_user.github_id = legacy_user.github_user_id::text
    ON CONFLICT (user_id, capture_id) DO NOTHING;
END $$;
