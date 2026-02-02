/**
 * GitHub API를 사용하여 외부 레포에 merged된 PR 목록을 가져옴
 *
 * @source https://github.com/dbwls99706/oss-contribution-card
 */

import https from 'https';

const REQUEST_TIMEOUT = 30000; // 30초

function httpsGet(url, headers, retries = 3, returnBuffer = false) {
  return new Promise((resolve, reject) => {
    const makeRequest = (attempt, currentUrl) => {
      const options = {
        headers: {
          ...headers,
          'User-Agent': 'github-contribution-widget'
        },
        timeout: REQUEST_TIMEOUT
      };

      const req = https.get(currentUrl || url, options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          if (attempt < retries) {
            makeRequest(attempt + 1, res.headers.location);
          } else {
            reject(new Error('Too many redirects'));
          }
          return;
        }

        if (returnBuffer) {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(Buffer.concat(chunks));
            } else {
              reject(new Error(`Failed to fetch buffer: ${res.statusCode}`));
            }
          });
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // 성공
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Failed to parse JSON response'));
            }
            return;
          }

          // Rate limit 처리
          if (res.statusCode === 403) {
            const rateLimitRemaining = res.headers['x-ratelimit-remaining'];
            const rateLimitReset = res.headers['x-ratelimit-reset'];
            if (rateLimitRemaining === '0') {
              const resetDate = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000) : null;
              reject(new Error(`GitHub API rate limit exceeded. Resets at: ${resetDate ? resetDate.toISOString() : 'unknown'}`));
              return;
            }
          }

          // 인증 오류
          if (res.statusCode === 401) {
            reject(new Error('GitHub API authentication failed. Please check your token.'));
            return;
          }

          // 서버 오류 시 재시도
          if (res.statusCode >= 500 && attempt < retries) {
            const delay = Math.pow(2, attempt) * 1000;
            setTimeout(() => makeRequest(attempt + 1), delay);
            return;
          }

          reject(new Error(`GitHub API error: ${res.statusCode}`));
        });
      });

      req.on('error', (err) => {
        // 네트워크 오류 시 재시도
        if (attempt < retries && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN')) {
          const delay = Math.pow(2, attempt) * 1000;
          setTimeout(() => makeRequest(attempt + 1), delay);
          return;
        }
        reject(new Error(`Network error: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          setTimeout(() => makeRequest(attempt + 1), delay);
          return;
        }
        reject(new Error('Request timed out'));
      });
    };

    makeRequest(0);
  });
}

async function fetchAvatarAsBase64(url) {
  try {
    const buffer = await httpsGet(url, {}, 2, true);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    return null;
  }
}

export async function fetchContributions(username, token = null, options = {}) {
  const { excludeOrgs = [], includeOrgs = [] } = options;

  // 입력 검증
  if (!username || typeof username !== 'string') {
    throw new Error('Username is required and must be a string');
  }

  const sanitizedUsername = username.trim();
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(sanitizedUsername)) {
    throw new Error('Invalid GitHub username format');
  }

  const headers = {
    'Accept': 'application/vnd.github.v3+json'
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  // 자신의 레포를 제외한 merged PR만 검색
  const query = encodeURIComponent(`author:${sanitizedUsername} type:pr is:merged -user:${sanitizedUsername}`);
  const url = `https://api.github.com/search/issues?q=${query}&per_page=100&sort=updated`;

  let data;
  try {
    data = await httpsGet(url, headers);
  } catch (err) {
    throw new Error(`Failed to fetch contributions: ${err.message}`);
  }

  // 응답 데이터 검증
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response from GitHub API');
  }

  // 레포별로 그룹화
  const repoMap = new Map();
  const items = Array.isArray(data.items) ? data.items : [];

  for (const item of items) {
    // 필수 필드 검증
    if (!item || !item.repository_url) {
      continue;
    }

    // repository_url에서 owner/repo 추출
    const repoFullName = item.repository_url.replace('https://api.github.com/repos/', '');

    if (!repoFullName || repoFullName === item.repository_url) {
      continue; // 잘못된 URL 형식 스킵
    }

    // org/user 필터링
    const orgName = repoFullName.split('/')[0].toLowerCase();

    // includeOrgs가 설정되어 있으면 해당 org만 포함
    if (includeOrgs.length > 0) {
      if (!includeOrgs.map(o => o.toLowerCase()).includes(orgName)) {
        continue;
      }
    }

    // excludeOrgs에 포함된 org는 제외
    if (excludeOrgs.length > 0) {
      if (excludeOrgs.map(o => o.toLowerCase()).includes(orgName)) {
        continue;
      }
    }

    if (!repoMap.has(repoFullName)) {
      const owner = repoFullName.split('/')[0];
      const avatarUrl = `https://github.com/${owner}.png?size=40`;
      
      repoMap.set(repoFullName, {
        name: repoFullName,
        owner: owner,
        avatarUrl: avatarUrl,
        avatarBase64: null,
        prs: [],
        latestMerge: null
      });
    }

    const repo = repoMap.get(repoFullName);
    const mergedAt = item.pull_request?.merged_at || null;
    
    const labels = Array.isArray(item.labels) ? item.labels.map(l => l.name) : [];

    repo.prs.push({
      number: item.number || 0,
      title: item.title || 'Untitled PR',
      url: item.html_url || '',
      mergedAt: mergedAt,
      labels: labels
    });

    // 가장 최근 merge 날짜 업데이트
    if (mergedAt && (!repo.latestMerge || new Date(mergedAt) > new Date(repo.latestMerge))) {
      repo.latestMerge = mergedAt;
    }
  }

  // 배열로 변환하고 PR 수 기준 정렬
  const contributions = Array.from(repoMap.values())
    .sort((a, b) => b.prs.length - a.prs.length);

  const topRepos = contributions.slice(0, 10);
  await Promise.all(topRepos.map(async (repo) => {
    repo.avatarBase64 = await fetchAvatarAsBase64(repo.avatarUrl);
  }));

  return {
    username: sanitizedUsername,
    totalPRs: data.total_count || 0,
    totalRepos: contributions.length,
    contributions
  };
}
