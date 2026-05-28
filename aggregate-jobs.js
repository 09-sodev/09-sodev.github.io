#!/usr/bin/env node

/**
 * DECODE YOURSELF - Job Aggregator
 * Pulls live, recent jobs from multiple FREE sources
 * Runs daily via GitHub Actions or cron
 * 
 * SMART DECISIONS:
 * - Target: Recent grads (0-2 years) + Interns
 * - Exclude: Mid-level, Senior, Lead roles
 * - Remove: Jobs older than 14 days (30 days for internships)
 * - Result: Fresh, relevant opportunities only
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
  minJobs: 20,
  maxJobAge: 14, // days
  maxInternshipAge: 30 // days
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
 * Smart job level detection
 * TARGET: Recent grads (0-2 years) + Interns
 * EXCLUDE: Mid-level, Senior, Lead roles
 */
function detectJobLevel(title, description) {
  const titleLower = title.toLowerCase();
  const descLower = (description || '').toLowerCase();
  
  // Recent Grad (0-6 months, no experience required)
  if (titleLower.includes('graduate') || 
      descLower.includes('recent graduate') ||
      descLower.includes('no experience necessary') ||
      descLower.includes('first job')) {
    return 'graduate';
  }
  
  // Internship/Apprenticeship (students)
  if (titleLower.includes('intern') || 
      titleLower.includes('apprentice') ||
      descLower.includes('student')) {
    return 'internship';
  }
  
  // Entry-Level (1-2 years, junior roles)
  if (titleLower.includes('junior') ||
      titleLower.includes('associate') ||
      titleLower.includes('analyst') ||
      titleLower.includes('coordinator') ||
      titleLower.includes('specialist') ||
      descLower.includes('1-2 years') ||
      descLower.includes('entry-level')) {
    return 'entry';
  }
  
  // Mid-level or higher (2+ years) - EXCLUDE
  if (titleLower.includes('senior') ||
      titleLower.includes('lead') ||
      titleLower.includes('manager') ||
      titleLower.includes('principal') ||
      descLower.includes('3+ years') ||
      descLower.includes('mid-level')) {
    return 'mid'; // Will be filtered out
  }
  
  return 'entry'; // Default to entry
}

/**
 * Check if job is too old
 * DECISION: Remove jobs older than 14 days
 * Exception: Keep internships for 30 days (they last longer)
 */
function isJobTooOld(postedDate, jobLevel) {
  const now = new Date();
  const postedTime = new Date(postedDate);
  const daysOld = (now - postedTime) / (1000 * 60 * 60 * 24);
  
  // Keep internships longer (they fill slower)
  if (jobLevel === 'internship') {
    return daysOld > CONFIG.maxInternshipAge;
  }
  
  // Remove other jobs after max age
  return daysOld > CONFIG.maxJobAge;
}

/**
 * Transform GitHub Jobs API response
 */
function transformGitHubJobs(jobs) {
  return jobs.slice(0, CONFIG.maxJobsPerSource).map((job, idx) => {
    const level = detectJobLevel(job.title, job.description);
    const posted = new Date().toISOString();
    
    return {
      id: `github-${job.id}`,
      title: job.title,
      company: job.company,
      category: categorizeByTitle(job.title),
      level: level,
      type: job.type === 'Full Time' ? 'onsite' : 'remote',
      location: job.location || 'Remote',
      salary: 'Competitive',
      description: stripHtml(job.description).substring(0, 150) + '...',
      source: 'github',
      sourceUrl: 'github.com/jobs',
      url: job.url,
      posted: posted,
      verified: true
    };
  });
}

/**
 * Transform RemoteOK API response
 */
function transformRemoteOKJobs(jobs) {
  return jobs
    .slice(0, CONFIG.maxJobsPerSource)
    .filter(job => {
      const title = (job.title || '').toLowerCase();
      return title.includes('junior') || title.includes('entry') || title.includes('graduate') || title.includes('intern');
    })
    .map((job, idx) => {
      const level = detectJobLevel(job.title, job.description);
      
      return {
        id: `remoteok-${idx}`,
        title: job.title,
        company: job.company_name || job.company,
        category: categorizeByTitle(job.title),
        level: level,
        type: 'remote',
        location: job.location || 'Remote',
        salary: job.salary_min && job.salary_max ? `$${job.salary_min/1000}K - $${job.salary_max/1000}K` : 'Competitive',
        description: (job.description || '').substring(0, 150) + '...',
        source: 'remoteok',
        sourceUrl: 'remoteok.io',
        url: job.url || `https://remoteok.io`,
        posted: job.created_at || new Date().toISOString(),
        verified: true
      };
    });
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
 * Filter jobs: remove stale and mid-level
 */
function filterAndRankJobs(jobs) {
  return jobs
    // Remove mid-level and above
    .filter(job => job.level !== 'mid')
    // Remove jobs that are too old
    .filter(job => !isJobTooOld(job.posted, job.level))
    // Sort by date (newest first)
    .sort((a, b) => new Date(b.posted) - new Date(a.posted));
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
  console.log(`🔄 After deduplication: ${allJobs.length} jobs`);
  
  // Filter and rank
  allJobs = filterAndRankJobs(allJobs);
  console.log(`✨ After filtering: ${allJobs.length} jobs (removed stale & mid-level)`);
  
  // Add metadata
  const result = {
    metadata: {
      totalJobs: allJobs.length,
      lastUpdated: new Date().toISOString(),
      sources: Object.keys(SOURCES).length,
      filters: {
        targetAudience: 'Recent grads (0-2 years) + Interns',
        maxJobAge: `${CONFIG.maxJobAge} days`,
        maxInternshipAge: `${CONFIG.maxInternshipAge} days`,
        excludedLevels: 'mid, senior, lead'
      },
      errors: errors
    },
    jobs: allJobs
  };
  
  // Save to file
  fs.writeFileSync(CONFIG.cacheFile, JSON.stringify(result, null, 2));
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✨ SUCCESS! ${allJobs.length} relevant jobs aggregated in ${duration}s`);
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
