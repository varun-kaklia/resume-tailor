/**
 * Reference data for job-description parsing.
 *
 * Extraction matches against a fixed vocabulary rather than trying to infer
 * what a skill looks like. A posting can call anything a requirement, so
 * pattern-guessing produces noise; a known term found in a known section is a
 * fact. Terms absent from this list are simply not extracted, which is a miss
 * the user can see and correct rather than a wrong answer they cannot.
 */

/**
 * Canonical skill names, keyed by the lowercase form used for matching.
 *
 * Aliases map to the same canonical value so `js`, `JavaScript` and `ES6` all
 * report as `JavaScript`, which keeps requirement lists free of duplicates.
 */
export const SKILL_TERMS: Readonly<Record<string, string>> = {
  // Languages
  javascript: 'JavaScript', js: 'JavaScript', typescript: 'TypeScript', ts: 'TypeScript',
  python: 'Python', java: 'Java', kotlin: 'Kotlin', swift: 'Swift', 'objective-c': 'Objective-C',
  go: 'Go', golang: 'Go', rust: 'Rust', ruby: 'Ruby', php: 'PHP', scala: 'Scala',
  elixir: 'Elixir', erlang: 'Erlang', haskell: 'Haskell', clojure: 'Clojure', perl: 'Perl',
  'c++': 'C++', cpp: 'C++', 'c#': 'C#', csharp: 'C#', c: 'C', r: 'R', matlab: 'MATLAB',
  dart: 'Dart', lua: 'Lua', bash: 'Bash', shell: 'Shell', powershell: 'PowerShell',
  sql: 'SQL', nosql: 'NoSQL', graphql: 'GraphQL', html: 'HTML', css: 'CSS', sass: 'Sass',

  // Frontend
  react: 'React', 'react.js': 'React', reactjs: 'React', vue: 'Vue', 'vue.js': 'Vue',
  angular: 'Angular', svelte: 'Svelte', preact: 'Preact', 'next.js': 'Next.js', nextjs: 'Next.js',
  nuxt: 'Nuxt', redux: 'Redux', tailwind: 'Tailwind CSS', webpack: 'Webpack', vite: 'Vite',
  jquery: 'jQuery', bootstrap: 'Bootstrap', 'react native': 'React Native', flutter: 'Flutter',

  // Backend and platform
  'node.js': 'Node.js', nodejs: 'Node.js', node: 'Node.js', express: 'Express',
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI', rails: 'Rails', spring: 'Spring',
  'spring boot': 'Spring Boot', dotnet: '.NET', '.net': '.NET', laravel: 'Laravel',
  nestjs: 'NestJS', grpc: 'gRPC', rest: 'REST', 'rest api': 'REST', microservices: 'Microservices',
  serverless: 'Serverless', websockets: 'WebSockets',

  // Data stores
  postgres: 'PostgreSQL', postgresql: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite',
  mongodb: 'MongoDB', mongo: 'MongoDB', redis: 'Redis', cassandra: 'Cassandra',
  dynamodb: 'DynamoDB', elasticsearch: 'Elasticsearch', snowflake: 'Snowflake',
  bigquery: 'BigQuery', redshift: 'Redshift', clickhouse: 'ClickHouse', neo4j: 'Neo4j',

  // Cloud and infrastructure
  aws: 'AWS', azure: 'Azure', gcp: 'GCP', 'google cloud': 'GCP', docker: 'Docker',
  kubernetes: 'Kubernetes', k8s: 'Kubernetes', terraform: 'Terraform', ansible: 'Ansible',
  jenkins: 'Jenkins', 'ci/cd': 'CI/CD', cicd: 'CI/CD', 'github actions': 'GitHub Actions',
  gitlab: 'GitLab', circleci: 'CircleCI', helm: 'Helm', nginx: 'Nginx', linux: 'Linux',
  lambda: 'AWS Lambda', ec2: 'EC2', s3: 'S3', prometheus: 'Prometheus', grafana: 'Grafana',
  datadog: 'Datadog', kafka: 'Kafka', rabbitmq: 'RabbitMQ', airflow: 'Airflow', spark: 'Spark',
  hadoop: 'Hadoop', dbt: 'dbt', kinesis: 'Kinesis',

  // Data and ML
  'machine learning': 'Machine Learning', ml: 'Machine Learning', 'deep learning': 'Deep Learning',
  tensorflow: 'TensorFlow', pytorch: 'PyTorch', 'scikit-learn': 'scikit-learn', pandas: 'pandas',
  numpy: 'NumPy', nlp: 'NLP', llm: 'LLMs', llms: 'LLMs', 'computer vision': 'Computer Vision',
  'data engineering': 'Data Engineering', etl: 'ETL', tableau: 'Tableau', 'power bi': 'Power BI',

  // Practice
  git: 'Git', agile: 'Agile', scrum: 'Scrum', kanban: 'Kanban', jira: 'Jira',
  tdd: 'TDD', 'unit testing': 'Unit Testing', jest: 'Jest', pytest: 'pytest', cypress: 'Cypress',
  playwright: 'Playwright', selenium: 'Selenium', observability: 'Observability',
  monitoring: 'Monitoring', 'distributed systems': 'Distributed Systems',
  'system design': 'System Design', accessibility: 'Accessibility', security: 'Security',
  oauth: 'OAuth', figma: 'Figma',
};

/**
 * Terms whose lowercase form collides with an ordinary English word.
 *
 * `go`, `c`, `r` and `rest` appear constantly in prose ("go to", "the rest of
 * the team"), so matching them the usual way fills a requirement list with
 * nonsense. These are only accepted next to a signal that the line is talking
 * about technology.
 */
export const AMBIGUOUS_TERMS: ReadonlySet<string> = new Set(['go', 'c', 'r', 'rest', 'node', 'spring', 'security', 'monitoring', 'shell']);

/** Nearby words that make an ambiguous term readable as a technology. */
export const TECH_CONTEXT = /\b(experience|proficien\w*|knowledge|skills?|language|framework|stack|program\w*|develop\w*|engineer\w*|writ\w*|cod\w*|using|with|in)\b/i;

/** Section headings introducing hard requirements. */
export const MUST_HEADINGS = [
  'requirements', 'required', 'qualifications', 'basic qualifications', 'minimum qualifications',
  'what you need', "what you'll need", 'what we are looking for', "what we're looking for",
  'must have', 'must-have', 'skills and experience', 'your profile', 'about you', 'who you are',
  'technical skills', 'required skills', 'essential',
];

/** Section headings introducing optional extras. */
export const NICE_HEADINGS = [
  'nice to have', 'nice-to-have', 'preferred', 'preferred qualifications', 'bonus',
  'bonus points', 'desired', 'a plus', 'pluses', 'good to have', 'additionally',
  'preferred skills', 'even better', 'icing on the cake',
];

/** Section headings introducing day-to-day duties. */
export const RESPONSIBILITY_HEADINGS = [
  'responsibilities', 'key responsibilities', 'what you will do', "what you'll do",
  'duties', 'day to day', 'day-to-day', 'in this role', 'you will', "you'll",
  'what you will be doing', "what you'll be doing",
];

/**
 * Headings that introduce prose about the role or the company rather than a
 * duty list. Treated as neutral: matching them stops the previous section
 * without pulling marketing copy into `responsibilities`.
 */
export const PROSE_HEADINGS = ['about the role', 'the role', 'role', 'your role', 'about the job', 'job description', 'overview', 'summary'];

/** Headings that end a section without starting a useful one. */
export const CLOSING_HEADINGS = [
  'benefits', 'perks', 'what we offer', 'compensation', 'salary', 'equal opportunity',
  'about us', 'about the company', 'our mission', 'how to apply', 'application process',
  'diversity', 'eeo', 'disclaimer', 'legal',
];

/** Inline phrases that downgrade a requirement on the same line to optional. */
export const NICE_INLINE = /\b(preferred|a plus|bonus|nice to have|desirable|ideally|would be great|not required|optional)\b/i;

/** Words in a line that suggest it names a role rather than describing one. */
export const TITLE_NOUNS = /\b(engineer|developer|architect|scientist|analyst|manager|designer|administrator|consultant|specialist|lead|director|intern|programmer|researcher|technician|strategist|writer|marketer|recruiter)\b/i;
