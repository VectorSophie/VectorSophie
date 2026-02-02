#!/usr/bin/env node

/**
 * OSS Contribution Card - GitHub 프로필에 오픈소스 기여 내역 표시
 *
 * @source https://github.com/dbwls99706/oss-contribution-card
 */

import { fetchContributions } from './fetch-contributions.js';
import { generateSVG, generateEmptySVG } from './generate-svg.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 테스트/데모용 mock 데이터
function getMockData(username) {
  const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  return {
    username,
    totalPRs: 2,
    totalRepos: 2,
    contributions: [
      {
        name: 'ros2/rclpy',
        owner: 'ros2',
        avatarUrl: 'https://github.com/ros2.png?size=40',
        avatarBase64: sampleBase64,
        prs: [
          {
            number: 1492,
            title: 'Fix: deadlock when calling rclpy.shutdown() from callbacks',
            url: 'https://github.com/ros2/rclpy/pull/1492',
            mergedAt: '2025-10-03T17:37:26Z',
            labels: ['bug', 'enhancement']
          }
        ],
        latestMerge: '2025-10-03T17:37:26Z'
      },
      {
        name: 'ros2/rosbag2',
        owner: 'ros2',
        avatarUrl: 'https://github.com/ros2.png?size=40',
        avatarBase64: sampleBase64,
        prs: [
          {
            number: 2135,
            title: 'Fix: Add null pointer check for reader_imp in the Reader constructor',
            url: 'https://github.com/ros2/rosbag2/pull/2135',
            mergedAt: '2025-08-14T11:10:31Z',
            labels: ['bug']
          }
        ],
        latestMerge: '2025-08-14T11:10:31Z'
      }
    ]
  };
}

async function main() {
  // 환경변수 또는 인자에서 설정 가져오기
  const username = process.env.GITHUB_USERNAME || process.argv[2];
  const token = process.env.GITHUB_TOKEN || null;
  const theme = process.env.THEME || 'light';
  const autoTheme = process.env.AUTO_THEME === 'true'; // GitHub 테마 자동 감지
  const maxRepos = parseInt(process.env.MAX_REPOS || '6', 10);
  const outputPath = process.env.OUTPUT_PATH || './contributions.svg';
  const title = process.env.TITLE || 'Open-Source Contributions';
  const sortBy = process.env.SORT_BY || 'date'; // 'date' or 'count'
  const monthsAgo = process.env.MONTHS_AGO ? parseInt(process.env.MONTHS_AGO, 10) : null;
  const excludeOrgs = process.env.EXCLUDE_ORGS ? process.env.EXCLUDE_ORGS.split(',').map(s => s.trim()).filter(Boolean) : [];
  const includeOrgs = process.env.INCLUDE_ORGS ? process.env.INCLUDE_ORGS.split(',').map(s => s.trim()).filter(Boolean) : [];
  const useMock = process.env.USE_MOCK === 'true' || process.argv.includes('--mock');

  if (!username) {
    console.error('Error: GitHub username is required.');
    console.error('Usage: GITHUB_USERNAME=<username> npm run generate');
    console.error('   or: node src/index.js <username>');
    process.exit(1);
  }

  console.log(`Fetching contributions for: ${username}`);
  console.log(`Theme: ${autoTheme ? 'auto (light/dark)' : theme}, Max repos: ${maxRepos}, Sort: ${sortBy}`);
  if (monthsAgo) {
    console.log(`Filtering: Last ${monthsAgo} months only`);
  }
  if (excludeOrgs.length > 0) {
    console.log(`Excluding orgs: ${excludeOrgs.join(', ')}`);
  }
  if (includeOrgs.length > 0) {
    console.log(`Including only orgs: ${includeOrgs.join(', ')}`);
  }

  try {
    const data = useMock ? getMockData(username) : await fetchContributions(username, token, { excludeOrgs, includeOrgs });

    console.log(`Found ${data.totalPRs} merged PRs in ${data.totalRepos} external repositories`);

    if (data.contributions.length > 0) {
      console.log('\nTop contributions:');
      data.contributions.slice(0, 5).forEach(repo => {
        console.log(`  - ${repo.name}: ${repo.prs.length} PR(s)`);
      });
    }

    // SVG 생성
    const svg = data.totalRepos > 0
      ? generateSVG(data, { theme, autoTheme, maxRepos, title, sortBy, monthsAgo })
      : generateEmptySVG(username, { theme, autoTheme, title });

    // 출력 디렉토리 생성 (필요시)
    const outputDir = dirname(outputPath);
    if (outputDir && outputDir !== '.' && !existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // 파일 저장
    writeFileSync(outputPath, svg);
    console.log(`\nSVG saved to: ${outputPath}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
