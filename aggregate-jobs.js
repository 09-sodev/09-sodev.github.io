#!/usr/bin/env node

/**
 * DECODE YOURSELF - Job Aggregator
 * 
 * The curated jobs-data.json is maintained manually with 78+ verified roles.
 * This script refreshes the lastUpdated timestamp so the site always shows
 * a current "last updated" time, and exits cleanly for GitHub Actions.
 *
 * To add or update jobs: edit jobs-data.json directly.
 */

const fs = require('fs');
const path = require('path');

const JOBS_FILE = path.join(__dirname, 'jobs-data.json');

function refreshTimestamp() {
  console.log('🚀 Refreshing job board timestamp...');

  const data = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));

  data.metadata.lastUpdated = new Date().toISOString();
  data.metadata.totalJobs = data.jobs.length;

  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2));

  console.log(`✅ Done. ${data.jobs.length} jobs live. Timestamp: ${data.metadata.lastUpdated}`);
  return data;
}

if (require.main === module) {
  try {
    const result = refreshTimestamp();
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

module.exports = { refreshTimestamp };
