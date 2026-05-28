#!/usr/bin/env node

/**
 * DECODE YOURSELF - Job Aggregator
 * Pulls live, recent jobs from multiple FREE sources
 * Runs daily via GitHub Actions or cron
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Store jobs as JSON
const JOBS_FILE = path.join(__dirname, 'jobs-data.json');

// Configuration
const CONFIG = {
  maxJobsPerSource: 50,
  cacheFile: JOBS_FILE,
  minJobs: 100 // Ensure we have minimum jobs
};

// Job sources
const SOURCES = {
  github: {
    name: 'GitHub Jobs',
    url: 'https://jobs.github.com/positions.json?description=entry-level',
    transform: transformGitHubJobs
  },
  remoteok: {
    name: 'RemoteOK',
    url: 'https://remoteok.io/api?search=entry+level',
    transform: transformRemoteOKJobs
  }
};

/**
 * Fetch from HTTPS endpoint
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
    }).on('error', reject).on('timeout', function() {
      this.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Transform GitHub Jobs API response
 */
function transformGitHubJobs(jobs) {
  return jobs.slice(0, CONFIG.maxJobsPerSource).map((job, idx) => ({
    id: `github-${job.id}`,
    title: job.title,
    company: job.company,
    category: categorizeByTitle(job.title),
    level: 'entry',
    type: job.type === 'Full Time' ? 'onsite' : 'remote',
    location: job.location || 'Remote',
    salary: 'Competitive',
    description: stripHtml(job.description).substring(0, 150) + '...',
    source: 'github',
    sourceUrl: 'github.com/jobs',
    url: job.url,
    posted: new Date().toISOString(),
    verified: true
  }));
}

/**
 * Transform RemoteOK API response
 */
function transformRemoteOKJobs(jobs) {
  // RemoteOK returns array, filter for entry-level
  return jobs
    .slice(0, CONFIG.maxJobsPerSource)
    .filter(job => {
      const title = (job.title || '').toLowerCase();
      return title.includes('junior') || title.includes('entry') || title.includes('graduate') || title.includes('intern');
    })
    .map((job, idx) => ({
      id: `remoteok-${idx}`,
      title: job.title,
      company: job.company_name || job.company,
      category: categorizeByTitle(job.title),
      level: 'entry',
      type: 'remote',
      location: job.location || 'Remote',
      salary: job.salary_min && job.salary_max ? `$${job.salary_min/1000}K - $${job.salary_max/1000}K` : 'Competitive',
      description: (job.description || '').substring(0, 150) + '...',
      source: 'remoteok',
      sourceUrl: 'remoteok.io',
      url: job.url || `https://remoteok.io`,
      posted: job.created_at || new Date().toISOString(),
      verified: true
    }));
}

/**
 * Categorize job by title
 */
function categorizeByTitle(title) {
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes('engineer') || titleLower.includes('developer') || titleLower.includes('programmer')) return 'technology';
  if (titleLower.includes('sales') || titleLower.includes('business development')) return 'sales';
  if (titleLower.includes('marketing') || titleLower.includes('content')) return 'marketing';
  if (titleLower.includes('data') || titleLower.includes('analyst')) return 'data';
  if (titleLower.includes('design') || titleLower.includes('ux') || titleLower.includes('ui')) return 'design';
  if (titleLower.includes('finance') || titleLower.includes('accounting')) return 'finance';
  if (titleLower.includes('operations') || titleLower.includes('manager')) return 'operations';
  if (titleLower.includes('consultant') || titleLower.includes('strategy')) return 'consulting';
  
  return 'operations';
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * Deduplicate jobs by title + company
 */
function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const key = `${job.title}|${job.company}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Main aggregation function
 */
async function aggregateJobs() {
  console.log('🚀 Starting job aggregation...');
  const startTime = Date.now();
  
  let allJobs = [];
  const errors = [];
  
  // Fetch from each source
  for (const [key, source] of Object.entries(SOURCES)) {
    try {
      console.log(`📡 Fetching from ${source.name}...`);
      const data = await fetchUrl(source.url);
      const transformedJobs = source.transform(data);
      allJobs = allJobs.concat(transformedJobs);
      console.log(`✅ Got ${transformedJobs.length} jobs from ${source.name}`);
    } catch (error) {
      errors.push(`❌ ${source.name}: ${error.message}`);
      console.error(`❌ Error fetching from ${source.name}:`, error.message);
    }
  }
  
  // Deduplicate
  allJobs = deduplicateJobs(allJobs);
  
  // Sort by date (newest first)
  allJobs.sort((a, b) => new Date(b.posted) - new Date(a.posted));
  
  // Add metadata
  const result = {
    metadata: {
      totalJobs: allJobs.length,
      lastUpdated: new Date().toISOString(),
      sources: Object.keys(SOURCES).length,
      errors: errors
    },
    jobs: allJobs
  };
  
  // Save to file
  fs.writeFileSync(CONFIG.cacheFile, JSON.stringify(result, null, 2));
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✨ SUCCESS! ${allJobs.length} jobs aggregated in ${duration}s`);
  console.log(`📁 Saved to ${CONFIG.cacheFile}`);
  
  if (errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    errors.forEach(err => console.log(`   ${err}`));
  }
  
  return result;
}

// Run if executed directly
if (require.main === module) {
  aggregateJobs()
    .then(result => {
      process.exit(result.metadata.totalJobs >= CONFIG.minJobs ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { aggregateJobs };
