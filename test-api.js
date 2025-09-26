#!/usr/bin/env node

// Simple test script for HTTP API endpoints
const BASE_URL = 'http://localhost:4000';

async function testSearchEndpoint() {
  console.log('\n🔍 Testing GET /api/songs/search...');
  
  try {
    const url = `${BASE_URL}/api/songs/search?q=love&strategy=exact&limit=3`;
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`✅ Status: ${response.status}`);
    console.log(`✅ Results count: ${data.results?.length || 0}`);
    console.log(`✅ Processing time: ${data.metadata?.processingTime}ms`);
    
    if (data.results && data.results.length > 0) {
      console.log(`✅ First result: ${data.results[0].artist} - ${data.results[0].title}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Search endpoint failed:', error.message);
    return false;
  }
}

async function testMapEndpoint() {
  console.log('\n🎵 Testing POST /api/map...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'I love you so much',
        allowExplicit: false
      })
    });
    
    const data = await response.json();
    
    console.log(`✅ Status: ${response.status}`);
    console.log(`✅ Processing time: ${data.metadata?.processingTime}ms`);
    
    if (data.primary) {
      console.log(`✅ Primary match: ${data.primary.artist} - ${data.primary.title} (${data.primary.year})`);
      console.log(`✅ Alternates count: ${data.alternates?.length || 0}`);
      console.log(`✅ Reasoning: ${data.why?.matchedPhrase || 'semantic match'}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Map endpoint failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing HTTP API Endpoints');
  console.log(`📍 Base URL: ${BASE_URL}`);
  
  const searchPassed = await testSearchEndpoint();
  const mapPassed = await testMapEndpoint();
  
  console.log('\n📊 Test Results:');
  console.log(`   Search Endpoint: ${searchPassed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Map Endpoint: ${mapPassed ? '✅ PASS' : '❌ FAIL'}`);
  
  if (searchPassed && mapPassed) {
    console.log('\n🎉 All API endpoints are working correctly!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some endpoints failed. Check server logs.');
    process.exit(1);
  }
}

main().catch(console.error);