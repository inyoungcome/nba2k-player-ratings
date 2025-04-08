import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from "cheerio";
import fs from "fs";

import { BASE_URL } from "./url.js";
import { CURRENT_TEAMS } from "./teams.js";
import { player } from "./player.js";
import { teamNamePrettier } from "./util.js";
import { parse } from "json2csv"

// Add stealth plugin
puppeteer.use(StealthPlugin());

/**
 * Get each team's URL.
 */
function getTeamsUrl(team) {
  let baseUrl = BASE_URL;
  return `${baseUrl}/teams/${team}`;
}

/**
 * Get all player urls in one team.
 */
async function getPlayersUrlsFromEachTeam(team) {
  let playerUrls = [];
  let teamUrl = getTeamsUrl(team);
  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    let browser;
    try {
      console.log(`Launching browser for team ${team}...`);
      browser = await puppeteer.launch({
        headless: "new",
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ],
        defaultViewport: null
      });
      
      console.log(`Browser launched successfully for team ${team}`);
      const page = await browser.newPage();
      
      // Set a realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Set timeouts
      await page.setDefaultNavigationTimeout(30000);
      await page.setDefaultTimeout(30000);
      
      // Add random delay before navigation
      await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
      
      console.log(`Navigating to ${teamUrl}...`);
      // Navigate to the page
      const response = await page.goto(teamUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      console.log(`Navigation completed with status ${response.status()} for team ${team}`);
      
      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()} - ${response.statusText()}`);
      }
      
      console.log(`Waiting for table to load for team ${team}...`);
      // Wait for the table
      await page.waitForSelector('tbody', { timeout: 30000 });
      
      console.log(`Table loaded successfully for team ${team}`);
      // Get the page content
      const content = await page.content();
      
      // Parse with cheerio
      let tbody = cheerio.load(content)("tbody");
      let table = tbody[0];
      let entries = cheerio.load(table)(".entry-font");

      for (let entry of entries) {
        let playerUrl = cheerio.load(entry)("a").attr("href");
        playerUrls.push(playerUrl);
      }

      if (playerUrls.length > 0) {
        console.log(`Found ${playerUrls.length} players for team ${team}`);
        await browser.close();
        return playerUrls;
      } else {
        throw new Error("Empty playerUrls length");
      }
    } catch (error) {
      console.log(`Attempt ${retryCount + 1} failed for team ${team}:`, error.message);
      
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          console.log('Error closing browser:', e.message);
        }
      }
      
      retryCount++;
      
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 5000;
        console.log(`Waiting ${Math.round(delay/1000)} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed to get player URLs for team ${team} after ${maxRetries} attempts`);
}

/**
 * Get each player's attribute details.
 */
async function getPlayerDetail(team, playerUrl) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const browser = await puppeteer.launch({
        headless: "new",
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--window-size=1920,1080',
          '--disable-extensions',
          '--disable-default-apps',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: {
          width: 1920,
          height: 1080
        },
        timeout: 60000,
        protocolTimeout: 60000,
        ignoreHTTPSErrors: true
      });
      
      const page = await browser.newPage();
      
      // Set a realistic user agent and viewport
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Set timeouts
      await page.setDefaultNavigationTimeout(60000);
      await page.setDefaultTimeout(60000);
      
      // Add additional headers
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1'
      });
      
      // Enable JavaScript
      await page.setJavaScriptEnabled(true);
      
      // Add random delay before navigation
      await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
      
      // Navigate to the page and wait for the content to load
      await page.goto(playerUrl, { 
        waitUntil: ['networkidle0', 'domcontentloaded'],
        timeout: 60000
      });
      
      // Wait for the content to be present
      await page.waitForSelector('.content', { timeout: 60000 });
      
      // Get the page content
      const content = await page.content();
      
      var p = new player();

      // name
      let nameDiv = cheerio.load(content)("h1");
      p.name = nameDiv.text().trim();

      // overall attribute
      let overallAttribute = cheerio.load(content)(".attribute-box-player");
      p.overallAttribute = parseInt(overallAttribute.text().trim());

      // team
      p.team = team;

      let attributes = cheerio.load(content)(
        ".content .card .card-body .list-no-bullet li .attribute-box"
      );

      // outside scoring
      let closeShot = attributes[0].children[0].data.trim();
      p.closeShot = parseInt(closeShot);
      let midRangeShot = attributes[1].children[0].data.trim();
      p.midRangeShot = parseInt(midRangeShot);
      let threePointShot = attributes[2].children[0].data.trim();
      p.threePointShot = parseInt(threePointShot);
      let freeThrow = attributes[3].children[0].data.trim();
      p.freeThrow = parseInt(freeThrow);
      let shotIQ = attributes[4].children[0].data.trim();
      p.shotIQ = parseInt(shotIQ);
      let offensiveConsistency = attributes[5].children[0].data.trim();
      p.offensiveConsistency = parseInt(offensiveConsistency);

      // badges
      const badgeRawData = cheerio.load(content)('.badge-count')
      let legendaryBadgeCount = badgeRawData[0].children[0].data
      p.legendaryBadgeCount = parseInt(legendaryBadgeCount)
      let purpleBadgeCount = badgeRawData[1].children[0].data
      p.purpleBadgeCount = parseInt(purpleBadgeCount)
      let goldBadgeCount = badgeRawData[2].children[0].data
      p.goldBadgeCount = parseInt(goldBadgeCount)
      let silverBadgeCount = badgeRawData[3].children[0].data
      p.silverBadgeCount = parseInt(silverBadgeCount)
      let bronzeBadgeCount = badgeRawData[4].children[0].data
      p.bronzeBadgeCount = parseInt(bronzeBadgeCount)
      let badgeCount = badgeRawData[5].children[0].data
      p.badgeCount = parseInt(badgeCount)

      const rawOutsideScoringCount = cheerio.load(content)('#pills-outscoring-tab').text();
      let digitMatch = rawOutsideScoringCount.match(/\((\d+)\)/);
      const outsideScoringCount = digitMatch ? parseInt(digitMatch[1], 10) : null;
      p.outsideScoringBadgeCount = outsideScoringCount

      const rawInsideScoringCount = cheerio.load(content)('#pills-inscoring-tab').text();
      digitMatch = rawInsideScoringCount.match(/\((\d+)\)/);
      const insideScoringCount = digitMatch ? parseInt(digitMatch[1], 10) : null;
      p.insideScoringBadgeCount= insideScoringCount

      const rawPlaymakingCount = cheerio.load(content)('#pills-playmaking-tab').text();
      digitMatch = rawPlaymakingCount.match(/\((\d+)\)/);
      const playmakingCount = digitMatch ? parseInt(digitMatch[1], 10) : null;
      p.insideScoringBadgeCount= playmakingCount

      const rawDefenseCount = cheerio.load(content)('#pills-defense-tab').text();
      digitMatch = rawDefenseCount.match(/\((\d+)\)/);
      const defenseCount = digitMatch ? parseInt(digitMatch[1], 10) : null;
      p.defensiveBadgeCount = defenseCount

      const rawReboundingCount = cheerio.load(content)('#pills-rebounding-tab').text();
      digitMatch = rawReboundingCount.match(/\((\d+)\)/);
      const reboundingCount = digitMatch ? parseInt(digitMatch[1], 10) : null;
      p.reboundingBadgeCount = reboundingCount

      const rawGeneralOffenseCount = cheerio.load(content)('#pills-genoffense-tab').text();
      digitMatch = rawGeneralOffenseCount.match(/\((\d+)\)/);
      const generalOffenseCount = digitMatch ? parseInt(digitMatch[1], 10) : null;
      p.generalOffenseBadgeCount = generalOffenseCount

      const rawAllAroundCount = cheerio.load(content)('#pills-allaround-tab').text();
      digitMatch = rawAllAroundCount.match(/\((\d+)\)/);
      const allAroundCount = digitMatch ? parseInt(digitMatch[1], 10) : null;
      p.allAroundBadgeCount = allAroundCount

      // height + position
      let generalStatParent = cheerio.load(content)('.header-subtitle')
      let heightStr = generalStatParent[0].children[6].children[1].children[0].data
      p.height = heightStr
      
      let position = (generalStatParent[0].children[4].children[1].children[0].data)
      p.position = position

      // athleticism
      let speed = attributes[6].children[0].data.trim();
      p.speed = parseInt(speed);
      let agility = attributes[7].children[0].data.trim();
      p.agility = parseInt(agility);
      let strength = attributes[8].children[0].data.trim();
      p.strength = parseInt(strength);
      let vertical = attributes[9].children[0].data.trim();
      p.vertical = parseInt(vertical);
      let stamina = attributes[10].children[0].data.trim();
      p.stamina = parseInt(stamina);
      let hustle = attributes[11].children[0].data.trim();
      p.hustle = parseInt(hustle);
      let overallDurability = attributes[12].children[0].data.trim();
      p.overallDurability = parseInt(overallDurability);

      // inside scoring
      let layup = attributes[13].children[0].data.trim();
      p.layup = parseInt(layup);
      let standingDunk = attributes[14].children[0].data.trim();
      p.standingDunk = parseInt(standingDunk);
      let drivingDunk = attributes[15].children[0].data.trim();
      p.drivingDunk = parseInt(drivingDunk);
      let postHook = attributes[16].children[0].data.trim();
      p.postHook = parseInt(postHook);
      let postFade = attributes[17].children[0].data.trim();
      p.postFade = parseInt(postFade);
      let postControl = attributes[18].children[0].data.trim();
      p.postControl = parseInt(postControl);
      let drawFoul = attributes[19].children[0].data.trim();
      p.drawFoul = parseInt(drawFoul);
      let hands = attributes[20].children[0].data.trim();
      p.hands = parseInt(hands);

      // playmaking
      let passAccuracy = attributes[21].children[0].data.trim();
      p.passAccuracy = parseInt(passAccuracy);
      let ballHandle = attributes[22].children[0].data.trim();
      p.ballHandle = parseInt(ballHandle);
      let speedWithBall = attributes[23].children[0].data.trim();
      p.speedWithBall = parseInt(speedWithBall);
      let passIQ = attributes[24].children[0].data.trim();
      p.passIQ = parseInt(passIQ);
      let passVision = attributes[25].children[0].data.trim();
      p.passVision = parseInt(passVision);

      // defense
      let interiorDefense = attributes[26].children[0].data.trim();
      p.interiorDefense = parseInt(interiorDefense);
      let perimeterDefense = attributes[27].children[0].data.trim();
      p.perimeterDefense = parseInt(perimeterDefense);
      let steal = attributes[28].children[0].data.trim();
      p.steal = parseInt(steal);
      let block = attributes[29].children[0].data.trim();
      p.block = parseInt(block);
      let helpDefenseIQ = attributes[30].children[0].data.trim();
      p.helpDefenseIQ = parseInt(helpDefenseIQ);
      let passPerception = attributes[31].children[0].data.trim();
      p.passPerception = parseInt(passPerception);
      let defensiveConsistency = attributes[32].children[0].data.trim();
      p.defensiveConsistency = parseInt(defensiveConsistency);

      // rebounding
      let offensiveRebound = attributes[33].children[0].data.trim();
      p.offensiveRebound = parseInt(offensiveRebound);
      let defensiveRebound = attributes[34].children[0].data.trim();
      p.defensiveRebound = parseInt(defensiveRebound);

      await browser.close();
      return p;
    } catch (error) {
      console.log(`Attempt ${retryCount + 1} failed for ${playerUrl}:`, error.message);
      retryCount++;
      
      // Add exponential backoff between retries
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 5000 + Math.random() * 5000;
        console.log(`Waiting ${Math.round(delay/1000)} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed to get player details after ${maxRetries} attempts`);
}

/**
 * Player sorting comparator to group by each team, then sort all players by overall attributes from highest to lowest among the team
 */
function sortPlayersWithTeamGroupBy(a, b) {
  return a.team === b.team
    ? b.overallAttribute - a.overallAttribute
    : a.team < b.team;
}

/**
 * Player sorting comparator to sort all players by overall attributes from highest to lowest among the whole league.
 */
function sortPlayersWithoutTeamGroupBy(a, b) {
  return b.overallAttribute - a.overallAttribute;
}

/**
 * Save data to local disk in JSON format. Every new run generates a new file.
 */
function saveData(db, filename) {
  try {
    // Convert player objects to plain objects for JSON serialization
    const plainData = db.map(player => ({
      name: player.name,
      team: player.team,
      position: player.position,
      height: player.height,
      overallAttribute: player.overallAttribute,
      // Outside Scoring
      closeShot: player.closeShot,
      midRangeShot: player.midRangeShot,
      threePointShot: player.threePointShot,
      freeThrow: player.freeThrow,
      shotIQ: player.shotIQ,
      offensiveConsistency: player.offensiveConsistency,
      // Inside Scoring
      layup: player.layup,
      standingDunk: player.standingDunk,
      drivingDunk: player.drivingDunk,
      postHook: player.postHook,
      postFade: player.postFade,
      postControl: player.postControl,
      drawFoul: player.drawFoul,
      hands: player.hands,
      // Playmaking
      passAccuracy: player.passAccuracy,
      ballHandle: player.ballHandle,
      speedWithBall: player.speedWithBall,
      passIQ: player.passIQ,
      passVision: player.passVision,
      // Defense
      interiorDefense: player.interiorDefense,
      perimeterDefense: player.perimeterDefense,
      steal: player.steal,
      block: player.block,
      helpDefenseIQ: player.helpDefenseIQ,
      passPerception: player.passPerception,
      defensiveConsistency: player.defensiveConsistency,
      // Rebounding
      offensiveRebound: player.offensiveRebound,
      defensiveRebound: player.defensiveRebound,
      // Athleticism
      speed: player.speed,
      agility: player.agility,
      strength: player.strength,
      vertical: player.vertical,
      stamina: player.stamina,
      hustle: player.hustle,
      overallDurability: player.overallDurability,
      // Badges
      legendaryBadgeCount: player.legendaryBadgeCount,
      purpleBadgeCount: player.purpleBadgeCount,
      goldBadgeCount: player.goldBadgeCount,
      silverBadgeCount: player.silverBadgeCount,
      bronzeBadgeCount: player.bronzeBadgeCount,
      badgeCount: player.badgeCount,
      outsideScoringBadgeCount: player.outsideScoringBadgeCount,
      insideScoringBadgeCount: player.insideScoringBadgeCount,
      playmakingBadgeCount: player.playmakingBadgeCount,
      defensiveBadgeCount: player.defensiveBadgeCount,
      reboundingBadgeCount: player.reboundingBadgeCount,
      generalOffenseBadgeCount: player.generalOffenseBadgeCount,
      allAroundBadgeCount: player.allAroundBadgeCount
    }));

    const jsonData = JSON.stringify(plainData, null, 2);
    fs.writeFileSync(filename, jsonData);
    console.log(`Successfully saved data to ${filename}`);
  } catch (error) {
    console.log(`Failed to save data to ${filename}:`, error);
  }
}

/**
 * Load existing player data from JSON file
 */
function loadExistingPlayers(filename) {
  if (!fs.existsSync(filename)) {
    return new Map();
  }

  try {
    const content = fs.readFileSync(filename, 'utf8');
    const playersData = JSON.parse(content);
    const players = new Map();

    playersData.forEach(player => {
      if (player.name && player.team && player.overallAttribute) {
        players.set(player.name.toLowerCase(), {
          ...player,
          lastUpdated: fs.statSync(filename).mtime
        });
      }
    });

    return players;
  } catch (error) {
    console.log(`Failed to load existing players from ${filename}:`, error);
    return new Map();
  }
}

/**
 * Check if a player's data already exists and is up to date
 */
function shouldFetchPlayer(playerName, team, existingPlayers) {
  const normalizedName = playerName.toLowerCase();
  const existingPlayer = existingPlayers.get(normalizedName);
  
  if (!existingPlayer) {
    return true; // Player not found, need to fetch
  }

  // Check if player data is older than 24 hours
  const now = new Date();
  const lastUpdated = existingPlayer.lastUpdated;
  const hoursSinceLastUpdate = (now - lastUpdated) / (1000 * 60 * 60);
  
  if (hoursSinceLastUpdate > 24) {
    return true; // Data is too old, need to update
  }

  if (existingPlayer.team !== team) {
    return true; // Player changed team, need to update
  }

  return false; // Player exists and data is recent, no need to fetch
}

/**
 * Get the latest JSON file in the data directory
 */
function getLatestJSONFile(prefix) {
  if (!fs.existsSync('./data')) {
    return null;
  }

  const files = fs.readdirSync('./data')
    .filter(file => file.startsWith(prefix) && file.endsWith('.json'))
    .map(file => ({
      name: file,
      path: `./data/${file}`,
      mtime: fs.statSync(`./data/${file}`).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

const main = async function () {
  let teams = CURRENT_TEAMS;
  var roster = new Map();
  var players = [];

  // Create data directory if it doesn't exist
  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
  }

  // Get latest JSON files and load existing data
  const latestTeamFile = getLatestJSONFile('2kroster_team_');
  const existingPlayers = latestTeamFile ? loadExistingPlayers(latestTeamFile) : new Map();

  // Create timestamp for new filenames
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const teamFilename = `./data/2kroster_team_${timestamp}.json`;
  const leagueFilename = `./data/2kroster_league_${timestamp}.json`;

  console.log("################ Fetching player urls ... ################");
  await Promise.all(
    teams.map(async (team) => {
      let playerUrls = await getPlayersUrlsFromEachTeam(team);
      roster.set(team, playerUrls);
    })
  );

  console.log("################ Fetching player details ... ################");
  for (let team of teams) {
    let playerUrls = roster.get(team);
    let prettiedTeamName = teamNamePrettier(team);

    console.log(`---------- ${prettiedTeamName} ----------`);

    for (let playerUrl of playerUrls) {
      try {
        // Extract player name from URL
        const playerName = playerUrl.split('/').pop().replace(/-/g, ' ');
        
        // Check if player data already exists and is up to date
        if (!shouldFetchPlayer(playerName, prettiedTeamName, existingPlayers)) {
          console.log(`Skipping ${playerName} - data already exists and is up to date`);
          // Add existing player data to current players array
          const existingPlayer = existingPlayers.get(playerName.toLowerCase());
          if (existingPlayer) {
            players.push(existingPlayer);
          }
          continue;
        }

        let player = await getPlayerDetail(prettiedTeamName, playerUrl);
        players.push(player);
        console.log(`Successfully fetched ${player.name}'s detail.`);
        
        // Save data after each successful player fetch
        let teamResult = [...players].sort(sortPlayersWithTeamGroupBy);
        let leagueResult = [...players].sort(sortPlayersWithoutTeamGroupBy);
        
        saveData(teamResult, teamFilename);
        saveData(leagueResult, leagueFilename);
      } catch (error) {
        console.log(`Failed to fetch player from ${playerUrl}:`, error.message);
        continue;
      }
    }
  }

  console.log("################ Data collection completed ################");
  console.log(`Team data saved to: ${teamFilename}`);
  console.log(`League data saved to: ${leagueFilename}`);
};

main();
