import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database with more questions...');

  // Check if already seeded
  const existingCount = await prisma.question.count();
  if (existingCount > 0) {
    console.log(`Database already has ${existingCount} questions. Skipping seed.`);
    return;
  }

  // Categories
  const geography = await prisma.category.create({
    data: {
      id: 'geography',
      name: 'Geography',
      depth: 0,
      path: 'geography',
    },
  });

  const mountains = await prisma.category.create({
    data: {
      id: 'geography/mountains',
      name: 'Mountains',
      parentId: geography.id,
      depth: 1,
      path: 'geography/mountains',
    },
  });

  const cities = await prisma.category.create({
    data: {
      id: 'geography/cities',
      name: 'Cities',
      parentId: geography.id,
      depth: 1,
      path: 'geography/cities',
    },
  });

  const countries = await prisma.category.create({
    data: {
      id: 'geography/countries',
      name: 'Countries',
      parentId: geography.id,
      depth: 1,
      path: 'geography/countries',
    },
  });

  const sports = await prisma.category.create({
    data: {
      id: 'sports',
      name: 'Sports',
      depth: 0,
      path: 'sports',
    },
  });

  const baseball = await prisma.category.create({
    data: {
      id: 'sports/baseball',
      name: 'Baseball',
      parentId: sports.id,
      depth: 1,
      path: 'sports/baseball',
    },
  });

  const basketball = await prisma.category.create({
    data: {
      id: 'sports/basketball',
      name: 'Basketball',
      parentId: sports.id,
      depth: 1,
      path: 'sports/basketball',
    },
  });

  const movies = await prisma.category.create({
    data: {
      id: 'movies',
      name: 'Movies',
      depth: 0,
      path: 'movies',
    },
  });

  const history = await prisma.category.create({
    data: {
      id: 'history',
      name: 'History',
      depth: 0,
      path: 'history',
    },
  });

  // Question 1: Mountains
  await prisma.question.create({
    data: {
      categoryId: mountains.id,
      difficulty: 1,
      questionText: 'Top 10 highest mountains in the world',
      tensionCutoff: 10,
      submitter: 'leeroy',
      source: 'wikipedia',
      tags: JSON.stringify(['geography', 'mountains', 'highest']),
      answers: {
        create: [
          { rank: 1, answerText: 'Mount Everest', displayValue: '8,849m', points: 1, aliases: JSON.stringify(['everest', 'sagarmatha', 'chomolungma']) },
          { rank: 2, answerText: 'K2', displayValue: '8,611m', points: 2 },
          { rank: 3, answerText: 'Kangchenjunga', displayValue: '8,586m', points: 3, aliases: JSON.stringify(['kanchenjunga']) },
          { rank: 4, answerText: 'Lhotse', displayValue: '8,516m', points: 4 },
          { rank: 5, answerText: 'Makalu', displayValue: '8,485m', points: 5 },
          { rank: 6, answerText: 'Cho Oyu', displayValue: '8,188m', points: 6 },
          { rank: 7, answerText: 'Dhaulagiri', displayValue: '8,167m', points: 7 },
          { rank: 8, answerText: 'Manaslu', displayValue: '8,163m', points: 8 },
          { rank: 9, answerText: 'Nanga Parbat', displayValue: '8,126m', points: 9 },
          { rank: 10, answerText: 'Annapurna', displayValue: '8,091m', points: 10 },
          { rank: 11, answerText: 'Gasherbrum I', displayValue: '8,080m', points: -5 },
          { rank: 12, answerText: 'Broad Peak', displayValue: '8,051m', points: -5 },
          { rank: 13, answerText: 'Gasherbrum II', displayValue: '8,035m', points: -5 },
          { rank: 14, answerText: 'Shishapangma', displayValue: '8,027m', points: -5 },
          { rank: 15, answerText: 'Gyachung Kang', displayValue: '7,952m', points: -5 },
        ],
      },
    },
  });

  // Question 2: Cities by population
  await prisma.question.create({
    data: {
      categoryId: cities.id,
      difficulty: 2,
      questionText: 'Top 10 most populous cities in the world',
      tensionCutoff: 10,
      submitter: 'ande',
      source: 'wikipedia',
      tags: JSON.stringify(['geography', 'cities', 'population']),
      answers: {
        create: [
          { rank: 1, answerText: 'Tokyo', displayValue: '37.4M', points: 1 },
          { rank: 2, answerText: 'Delhi', displayValue: '32.9M', points: 2 },
          { rank: 3, answerText: 'Shanghai', displayValue: '29.2M', points: 3 },
          { rank: 4, answerText: 'Dhaka', displayValue: '23.2M', points: 4 },
          { rank: 5, answerText: 'São Paulo', displayValue: '22.6M', points: 5, aliases: JSON.stringify(['sao paulo']) },
          { rank: 6, answerText: 'Mexico City', displayValue: '22.3M', points: 6 },
          { rank: 7, answerText: 'Cairo', displayValue: '22.1M', points: 7 },
          { rank: 8, answerText: 'Beijing', displayValue: '21.8M', points: 8 },
          { rank: 9, answerText: 'Mumbai', displayValue: '21.3M', points: 9 },
          { rank: 10, answerText: 'Osaka', displayValue: '19.0M', points: 10 },
          { rank: 11, answerText: 'Chongqing', displayValue: '17.3M', points: -5 },
          { rank: 12, answerText: 'Karachi', displayValue: '17.2M', points: -5 },
          { rank: 13, answerText: 'Istanbul', displayValue: '15.8M', points: -5 },
          { rank: 14, answerText: 'Buenos Aires', displayValue: '15.5M', points: -5 },
          { rank: 15, answerText: 'Kolkata', displayValue: '15.3M', points: -5 },
        ],
      },
    },
  });

  // Question 3: Countries by area
  await prisma.question.create({
    data: {
      categoryId: countries.id,
      difficulty: 2,
      questionText: 'Top 10 largest countries by land area',
      tensionCutoff: 10,
      submitter: 'leeroy',
      source: 'wikipedia',
      tags: JSON.stringify(['geography', 'countries', 'area']),
      answers: {
        create: [
          { rank: 1, answerText: 'Russia', displayValue: '17.1M km²', points: 1 },
          { rank: 2, answerText: 'Canada', displayValue: '9.9M km²', points: 2 },
          { rank: 3, answerText: 'China', displayValue: '9.6M km²', points: 3 },
          { rank: 4, answerText: 'United States', displayValue: '9.3M km²', points: 4, aliases: JSON.stringify(['usa', 'us', 'america']) },
          { rank: 5, answerText: 'Brazil', displayValue: '8.5M km²', points: 5 },
          { rank: 6, answerText: 'Australia', displayValue: '7.7M km²', points: 6 },
          { rank: 7, answerText: 'India', displayValue: '3.3M km²', points: 7 },
          { rank: 8, answerText: 'Argentina', displayValue: '2.8M km²', points: 8 },
          { rank: 9, answerText: 'Kazakhstan', displayValue: '2.7M km²', points: 9 },
          { rank: 10, answerText: 'Algeria', displayValue: '2.4M km²', points: 10 },
          { rank: 11, answerText: 'DR Congo', displayValue: '2.3M km²', points: -5 },
          { rank: 12, answerText: 'Saudi Arabia', displayValue: '2.1M km²', points: -5 },
          { rank: 13, answerText: 'Mexico', displayValue: '1.9M km²', points: -5 },
          { rank: 14, answerText: 'Indonesia', displayValue: '1.9M km²', points: -5 },
          { rank: 15, answerText: 'Sudan', displayValue: '1.8M km²', points: -5 },
        ],
      },
    },
  });

  // Question 4: MLB World Series
  await prisma.question.create({
    data: {
      categoryId: baseball.id,
      difficulty: 3,
      questionText: 'Top 10 MLB teams by World Series championships',
      tensionCutoff: 10,
      submitter: 'leeroy',
      source: 'wikipedia',
      tags: JSON.stringify(['sports', 'baseball', 'mlb', 'championships']),
      answers: {
        create: [
          { rank: 1, answerText: 'New York Yankees', displayValue: '27 titles', points: 1, aliases: JSON.stringify(['yankees']) },
          { rank: 2, answerText: 'St. Louis Cardinals', displayValue: '11 titles', points: 2, aliases: JSON.stringify(['cardinals']) },
          { rank: 3, answerText: 'Boston Red Sox', displayValue: '9 titles', points: 3, aliases: JSON.stringify(['red sox']) },
          { rank: 4, answerText: 'Oakland Athletics', displayValue: '9 titles', points: 4, aliases: JSON.stringify(['athletics', 'as', 'as']) },
          { rank: 5, answerText: 'San Francisco Giants', displayValue: '8 titles', points: 5, aliases: JSON.stringify(['giants']) },
          { rank: 6, answerText: 'Los Angeles Dodgers', displayValue: '8 titles', points: 6, aliases: JSON.stringify(['dodgers']) },
          { rank: 7, answerText: 'Cincinnati Reds', displayValue: '5 titles', points: 7, aliases: JSON.stringify(['reds']) },
          { rank: 8, answerText: 'Pittsburgh Pirates', displayValue: '5 titles', points: 8, aliases: JSON.stringify(['pirates']) },
          { rank: 9, answerText: 'Detroit Tigers', displayValue: '4 titles', points: 9, aliases: JSON.stringify(['tigers']) },
          { rank: 10, answerText: 'Chicago White Sox', displayValue: '3 titles', points: 10, aliases: JSON.stringify(['white sox']) },
          { rank: 11, answerText: 'Chicago Cubs', displayValue: '3 titles', points: -5, aliases: JSON.stringify(['cubs']) },
          { rank: 12, answerText: 'Atlanta Braves', displayValue: '4 titles', points: -5, aliases: JSON.stringify(['braves']) },
          { rank: 13, answerText: 'Baltimore Orioles', displayValue: '3 titles', points: -5, aliases: JSON.stringify(['orioles']) },
          { rank: 14, answerText: 'Minnesota Twins', displayValue: '3 titles', points: -5, aliases: JSON.stringify(['twins']) },
          { rank: 15, answerText: 'Philadelphia Phillies', displayValue: '2 titles', points: -5, aliases: JSON.stringify(['phillies']) },
        ],
      },
    },
  });

  // Question 5: NBA Championships
  await prisma.question.create({
    data: {
      categoryId: basketball.id,
      difficulty: 3,
      questionText: 'Top 10 NBA teams by championships',
      tensionCutoff: 10,
      submitter: 'ande',
      source: 'wikipedia',
      tags: JSON.stringify(['sports', 'basketball', 'nba', 'championships']),
      answers: {
        create: [
          { rank: 1, answerText: 'Boston Celtics', displayValue: '18 titles', points: 1, aliases: JSON.stringify(['celtics']) },
          { rank: 2, answerText: 'Los Angeles Lakers', displayValue: '17 titles', points: 2, aliases: JSON.stringify(['lakers']) },
          { rank: 3, answerText: 'Golden State Warriors', displayValue: '7 titles', points: 3, aliases: JSON.stringify(['warriors']) },
          { rank: 4, answerText: 'Chicago Bulls', displayValue: '6 titles', points: 4, aliases: JSON.stringify(['bulls']) },
          { rank: 5, answerText: 'San Antonio Spurs', displayValue: '5 titles', points: 5, aliases: JSON.stringify(['spurs']) },
          { rank: 6, answerText: 'Philadelphia 76ers', displayValue: '3 titles', points: 6, aliases: JSON.stringify(['76ers', 'sixers']) },
          { rank: 7, answerText: 'Detroit Pistons', displayValue: '3 titles', points: 7, aliases: JSON.stringify(['pistons']) },
          { rank: 8, answerText: 'Miami Heat', displayValue: '3 titles', points: 8, aliases: JSON.stringify(['heat']) },
          { rank: 9, answerText: 'Milwaukee Bucks', displayValue: '2 titles', points: 9, aliases: JSON.stringify(['bucks']) },
          { rank: 10, answerText: 'Houston Rockets', displayValue: '2 titles', points: 10, aliases: JSON.stringify(['rockets']) },
          { rank: 11, answerText: 'New York Knicks', displayValue: '2 titles', points: -5, aliases: JSON.stringify(['knicks']) },
          { rank: 12, answerText: 'Toronto Raptors', displayValue: '1 title', points: -5, aliases: JSON.stringify(['raptors']) },
          { rank: 13, answerText: 'Cleveland Cavaliers', displayValue: '1 title', points: -5, aliases: JSON.stringify(['cavaliers', 'cavs']) },
          { rank: 14, answerText: 'Dallas Mavericks', displayValue: '1 title', points: -5, aliases: JSON.stringify(['mavericks', 'mavs']) },
          { rank: 15, answerText: 'Denver Nuggets', displayValue: '1 title', points: -5, aliases: JSON.stringify(['nuggets']) },
        ],
      },
    },
  });

  // Question 6: Highest grossing movies
  await prisma.question.create({
    data: {
      categoryId: movies.id,
      difficulty: 2,
      questionText: 'Top 10 highest grossing movies of all time',
      tensionCutoff: 10,
      submitter: 'leeroy',
      source: 'box office mojo',
      tags: JSON.stringify(['movies', 'box office', 'highest grossing']),
      answers: {
        create: [
          { rank: 1, answerText: 'Avatar', displayValue: '$2.9B', points: 1 },
          { rank: 2, answerText: 'Avengers: Endgame', displayValue: '$2.8B', points: 2, aliases: JSON.stringify(['endgame', 'avengers endgame']) },
          { rank: 3, answerText: 'Avatar: The Way of Water', displayValue: '$2.3B', points: 3, aliases: JSON.stringify(['avatar 2', 'way of water']) },
          { rank: 4, answerText: 'Titanic', displayValue: '$2.2B', points: 4 },
          { rank: 5, answerText: 'Star Wars: The Force Awakens', displayValue: '$2.1B', points: 5, aliases: JSON.stringify(['force awakens', 'star wars 7']) },
          { rank: 6, answerText: 'Avengers: Infinity War', displayValue: '$2.0B', points: 6, aliases: JSON.stringify(['infinity war']) },
          { rank: 7, answerText: 'Spider-Man: No Way Home', displayValue: '$1.9B', points: 7, aliases: JSON.stringify(['no way home', 'spiderman no way home']) },
          { rank: 8, answerText: 'Jurassic World', displayValue: '$1.7B', points: 8 },
          { rank: 9, answerText: 'The Lion King', displayValue: '$1.6B', points: 9, aliases: JSON.stringify(['lion king 2019']) },
          { rank: 10, answerText: 'The Avengers', displayValue: '$1.5B', points: 10, aliases: JSON.stringify(['avengers 2012', 'the avengers 2012']) },
          { rank: 11, answerText: 'Furious 7', displayValue: '$1.5B', points: -5, aliases: JSON.stringify(['fast and furious 7', 'fast 7']) },
          { rank: 12, answerText: 'Top Gun: Maverick', displayValue: '$1.5B', points: -5 },
          { rank: 13, answerText: 'Frozen II', displayValue: '$1.4B', points: -5, aliases: JSON.stringify(['frozen 2']) },
          { rank: 14, answerText: 'Barbie', displayValue: '$1.4B', points: -5 },
          { rank: 15, answerText: 'Beauty and the Beast', displayValue: '$1.3B', points: -5 },
        ],
      },
    },
  });

  // Question 7: US Presidents (longest serving — FDR then full two-term presidents by inauguration order)
  await prisma.question.create({
    data: {
      categoryId: history.id,
      difficulty: 3,
      questionText: 'Top 10 longest serving US Presidents',
      tensionCutoff: 10,
      submitter: 'ande',
      source: 'wikipedia',
      tags: JSON.stringify(['history', 'us presidents', 'term length']),
      answers: {
        create: [
          { rank: 1, answerText: 'Franklin D. Roosevelt', displayValue: '12 years, 39 days', points: 1, aliases: JSON.stringify(['fdr', 'roosevelt', 'franklin roosevelt']) },
          { rank: 2, answerText: 'Thomas Jefferson', displayValue: '8 years', points: 2, aliases: JSON.stringify(['jefferson']) },
          { rank: 3, answerText: 'James Madison', displayValue: '8 years', points: 3, aliases: JSON.stringify(['madison']) },
          { rank: 4, answerText: 'James Monroe', displayValue: '8 years', points: 4, aliases: JSON.stringify(['monroe']) },
          { rank: 5, answerText: 'Andrew Jackson', displayValue: '8 years', points: 5, aliases: JSON.stringify(['jackson']) },
          { rank: 6, answerText: 'Ulysses S. Grant', displayValue: '8 years', points: 6, aliases: JSON.stringify(['grant', 'ulysses grant']) },
          { rank: 7, answerText: 'Grover Cleveland', displayValue: '8 years', points: 7, aliases: JSON.stringify(['cleveland']) },
          { rank: 8, answerText: 'Woodrow Wilson', displayValue: '8 years', points: 8, aliases: JSON.stringify(['wilson']) },
          { rank: 9, answerText: 'Dwight D. Eisenhower', displayValue: '8 years', points: 9, aliases: JSON.stringify(['eisenhower', 'ike']) },
          { rank: 10, answerText: 'Ronald Reagan', displayValue: '8 years', points: 10, aliases: JSON.stringify(['reagan']) },
          { rank: 11, answerText: 'Bill Clinton', displayValue: '8 years', points: -5, aliases: JSON.stringify(['clinton', 'william clinton']) },
          { rank: 12, answerText: 'George W. Bush', displayValue: '8 years', points: -5, aliases: JSON.stringify(['bush', 'george bush', 'gw bush']) },
          { rank: 13, answerText: 'Barack Obama', displayValue: '8 years', points: -5, aliases: JSON.stringify(['obama']) },
          { rank: 14, answerText: 'Harry S. Truman', displayValue: '7 years, 283 days', points: -5, aliases: JSON.stringify(['truman']) },
          { rank: 15, answerText: 'Calvin Coolidge', displayValue: '5 years, 214 days', points: -5, aliases: JSON.stringify(['coolidge']) },
        ],
      },
    },
  });

  // Update category question counts
  await prisma.category.update({ where: { id: mountains.id }, data: { questionCount: 1 } });
  await prisma.category.update({ where: { id: cities.id }, data: { questionCount: 1 } });
  await prisma.category.update({ where: { id: countries.id }, data: { questionCount: 1 } });
  await prisma.category.update({ where: { id: baseball.id }, data: { questionCount: 1 } });
  await prisma.category.update({ where: { id: basketball.id }, data: { questionCount: 1 } });
  await prisma.category.update({ where: { id: movies.id }, data: { questionCount: 1 } });
  await prisma.category.update({ where: { id: history.id }, data: { questionCount: 1 } });

  const questionCount = await prisma.question.count();
  const answerCount = await prisma.answer.count();
  
  console.log('✅ Database seeded successfully!');
  console.log(`   - ${7} categories`);
  console.log(`   - ${questionCount} questions`);
  console.log(`   - ${answerCount} answers`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
