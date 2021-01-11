
'use strict'

const async = require('async');
const AWS = require('aws-sdk');
const handlebars = require('handlebars');
const superagent = require('superagent');
const fs = require('fs').promises;


//  design:
// dashboard panel with columns
// func to call whale API to get some data
// func to bucket the data and flush to disk?

// AWS -> Terraform using single account but multiple stages by keeping track of local tf state files


let RUNTIME_ENV = "dev";

// TODO - move to external config file?
let config = {
	"STATIC_CONTENT_PATH": {"dev": "./", "test": "/opt/", "qa": "/opt/"},
	"DEFAULT_AWS_CONFIG_PATH": ""
}


// single entry point from tha gateway API to reduce amoount of boiler-plate code in terraform files
module.exports.dashboard = async (event, context) => {
	// take in args for what cmd to run
	//  one for returning the buckets
	//  one for returning the html template

    console.log('Event: ', JSON.stringify(event, null, '\t'));
    console.log('Context: ', JSON.stringify(context, null, '\t'));


    // we check for AWS_LAMBDA_FUNCTION_NAME env var to see if we are running inside lambda or somewhere else
    if ('RUNTIME_ENV' in process.env)
    	RUNTIME_ENV = process.env.RUNTIME_ENV;

    // if local dev then we need to explicitly load the default aws config file with regions, etc
    // https://stackoverflow.com/questions/31039948/configuring-region-in-node-js-aws-sdk
    // TODO - correctly load from config file instead!
    if(RUNTIME_ENV == "dev")
    	AWS.config.update({region:'ap-northeast-1'});

    let cmd = event.queryStringParameters.cmd;
	let func = null;
    switch ( cmd ) {
    	case 'get_page':
    		func = get_page;
    		break;
    	case 'get_front':
    		func = get_front;
    		break;
    	case 'get_whale_buckets':
    		func = get_whale_buckets;
    		break;
    	case 'get_db_buckets':
    		func = get_db_buckets;
    		break;
    	case 'update_db':
    		func = update_db;
    		break;
    	default:
    		// return a proper error msg to the user?? -> list valid commands -> swagger!!!
    		console.log( "Command not recognized!", event.queryStringParameters );
    		break;
	}
	// waitforGeeksforGeeks();
	// console.log("post step");
	// return;
  
  // let callback_func = (data) => { callback(null, data); };
  // this yields as soon as we hit the first await -> so we must do everything itside it
	try {
		let res = await func(event.queryStringParameters);
		// console.log( "dashbaord res:", res );
  		return res;
	} catch (err) {
		console.log(err);
    	return err;
	}
}


AWS.config.update({region:'ap-northeast-1'});
var documentClient = new AWS.DynamoDB.DocumentClient();
const insertAccount = async (e) => {
  const params = {
    Item: e,
    TableName: 'wtb_api_events-dev'
  };
  return documentClient.put(params).promise(); // convert to Promise
}

function resolvelater() { 
  return new Promise(resolve => { 
    setTimeout(() => { 
      resolve('GeeksforGeeks'); 
    }, 2000); 
  });
} 
  
async function waitforGeeksforGeeks() { 
  console.log('calling'); 
  const result = await resolvelater(); 
  console.log(result);
}
  



// how to know if we should look localy or in opt?????
async function get_page( params )
{
	let source_path = config.STATIC_CONTENT_PATH[RUNTIME_ENV] + 'static/main.handlebars';
	let source = await fs.readFile( source_path, "utf8"); //, (err, source) => {
	// not sure how to handle errors yet
    // if (err) throw err;
	// var template = handlebars.compile(source);
	var html = source; // we will render everything client-side instead
	var response = {
		statusCode: 200,
		headers: {
		  'Content-Type': 'text/html; charset=utf-8'
		},
		body: html,
	}
	return response;
}

async function get_front( params )
{
  var response = {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    },
    body: '<p>Hello world!</p>',
  }
  return response;
}

// second end-point to fetch bucket data
async function get_whale_buckets( params )
{
	console.log( params );
    let alert_api = new WhaleAlertApi();
    let api_data = await alert_api.get_data( params );
	let buckets =  alert_api.bucket_data( api_data );
	if( !buckets ) return { statusCode: 500, body: 'Something wrong getting data buckets!' };

	var response = {
	    statusCode: 200,
	    headers: {'Content-Type': 'application/json'},
	    body: JSON.stringify( buckets ),
	  }
	return response;
}

// second end-point to fetch bucket data
async function update_db( params )
{
	console.log( params );
    let alert_api = new WhaleAlertApi();
    let api_data = await alert_api.get_data( params );
    
    console.log("got data");
    if( !api_data ) return { statusCode: 500, body: 'Error fetching data from downstream API!' };

    let save_res = await alert_api.save_to_db( api_data );
    console.log( "saved data", save_res );

    if( !save_res ) return { statusCode: 500, body: 'Error saving data!' };

    let count = api_data.transactions.length;
    var response = {
	    statusCode: 200,
	    headers: {'Content-Type': 'application/json'},
	    body: '{"msg":"all '+count+' records saved to db"}',
	  }
	console.log( "returning from update_db" );
	return response;
}


// second end-point to fetch bucket data
async function get_db_buckets( params )
{
	//DRY!!!
	console.log( params );
    let alert_api = new WhaleAlertApi();
    let api_data = await alert_api.get_from_db( params );
	let buckets =  alert_api.bucket_data_exchange( api_data );
	let buckets_timeseries =  alert_api.bucket_data_timeseries( api_data );
	buckets["buckets_timeseries"] = buckets_timeseries;
	if( !buckets ) return { statusCode: 500, body: 'Something wrong getting aws data buckets!' };

	var response = {
	    statusCode: 200,
	    headers: {'Content-Type': 'application/json'},
	    body: JSON.stringify( buckets ),
	  }
	return response;
}


class WhaleAlertApi
{
    // timestamp => date "+%s"
    // https://api.whale-alert.io/v1/transactions?api_key=oCAcALPSl98tCbEnzMuq2n0gwbYPClZy&start=1609437963
	constructor()
	{
		// TODO - move out to some out-of-source env config tool for keeping track of keys - AWS <something>?
	    this.api_key = "oCAcALPSl98tCbEnzMuq2n0gwbYPClZy";

	}

	// for now can we just setup a proxy???????!!!

	get_data_sync( params, callback_func )
	{
        // const fetch_params = { method: 'GET', mode: 'cors' };
		let start_timestamp = Math.floor(Date.now()/1000) - 3540 ; // last 59min
		let url = "https://api.whale-alert.io/v1/transactions?";
        console.log( "start:", start_timestamp );

        // superagent.get( "https://example.com" ).then( data => { console.log(data) } );
        // https://api.whale-alert.io/v1/transactions?api_key=oCAcALPSl98tCbEnzMuq2n0gwbYPClZy&start=1609806534

        let query = { "api_key": this.api_key, "start": start_timestamp };
        if( "cursor" in params )
        	query["cursor"] = params.cursor;

        // let m_url = url + "api_key="+this.api_key+"&start="+start_timestamp; 
        // we are going to roll our own proxy in php - like 5 lines of code :D - I forget how easy php is
        // let f_url = "https://ixspeed.com/proxy.php?"+m_url;
        console.log( url, query, params );
        superagent.get( url )
        .query( query )
        // .then( data => { /*console.log( data.body );*/ return callback_func( data.body ) } )
        .then( data => { return data.body; } )
        .catch( (err) => {
        	console.log("Too many requests to the API?");
        	console.log(err);
        	return false;
        });

        console.log("returning true from get_data");
        return true;
    }

    async get_data( params )
	{
		return new Promise(resolve => {
			// let start_timestamp = Math.floor(Date.now()/1000) - 3540 ; // last 59min
			let start_timestamp = Math.floor(Date.now()/1000) - 300 ; // last 5min
			let url = "https://api.whale-alert.io/v1/transactions?";

	        // https://api.whale-alert.io/v1/transactions?api_key=oCAcALPSl98tCbEnzMuq2n0gwbYPClZy&start=1609806534
	        // let api_key = "oCAcALPSl98tCbEnzMuq2n0gwbYPClZy";
	        let query = { "api_key": this.api_key, "start": start_timestamp };
	        if( "cursor" in params )
	        	query["cursor"] = params.cursor;

	        console.log( url, query, params );
	        superagent.get( url )
	        .query( query )
	        // .then( data => { /*console.log( data.body );*/ return callback_func( data.body ) } )
	        .then( data => { resolve(data.body); } )
	        .catch( (err) => {
	        	console.log("Too many requests to the API?");
	        	console.log(err);
	        	resolve(false);
	        });
	        console.log("returning true from get_data");
	  	});
    }


    async save_to_db( data )
    {
		let db_handle = new AWS.DynamoDB.DocumentClient();
		console.log("saving data to db2", data.transactions.length);
		// console.log(data);
		let total = data.transactions.length;

		// https://stackoverflow.com/questions/65558345/using-promises-in-a-lambda-node-for-loop
		for( let i = 0; i < total; i++)
    	{
    		// console.log( "index:", i );
    		let item = data.transactions[i];
    		
    		let params = {
	    		TableName:"wtb_api_events-"+RUNTIME_ENV,
	    		Item: item
			};
			await this._save_data( db_handle, item )
			.catch((error) => {
			    console.log(error);
			   throw error; //don't care about this error, just continue
			});
    	}
    	return {"body": "all good", statusCode: 200};

    }

	async _save_data( db_handle, item )
	{
	  let params = {
	    Item: item,
	    TableName:"wtb_api_events-"+RUNTIME_ENV,
	  };
	  return db_handle.put(params).promise();
	}

	async get_from_db( {start_timestamp, end_timestamp} )
	{
		// start_timestamp = Math.floor(Date.now()/1000) - 3540 ; // last 59min -> move to front-end param
		let db_handle = new AWS.DynamoDB.DocumentClient();

    		// TableName:"wtb_api_events-"+RUNTIME_ENV,
    		// force fetch ro mthe test tablefor now because that is only one upto date
		let params = {
			TableName:"wtb_api_events-test",
    		IndexName: "gsi-symbol",
    		ExpressionAttributeNames: { '#timestamp': 'timestamp' },
			ExpressionAttributeValues: { ':start_timestamp': Number(start_timestamp),
											':end_timestamp': Number(end_timestamp),
											':symbol': "btc" },
			KeyConditionExpression: 'symbol = :symbol',
			FilterExpression: '#timestamp >= :start_timestamp AND #timestamp <= :end_timestamp'
		};
		console.log( params );

		let data = await db_handle.query( params ).promise();
		// handle no data!
		console.log( "data count:", data.Count );
		return data;
	}


	// assume 1m freq
	bucket_data_timeseries( data )
	{
		let buckets = {};
		let min = 0;
		let max = 0;
		for( const item of data.Items )
    	{
    		if( ! this._is_entry_supported(item) )
    			continue;
    		// console.log( item );	

    		let symbol = item.symbol;
    		let amount_usd = item.amount_usd;
    		let timestamp = item.timestamp;
    		let from = item.from.owner_type;
    		if( from != "unknown" ) from = item.from.owner;
    		let to = item.to.owner_type;
    		if( to != "unknown" ) to = item.to.owner;


    		// floor to nearest minute
    		let time_bucket = Math.floor(timestamp / 60) * 60 * 1000;
    		// console.log( buckets, time_bucket in buckets );
    		if( ! buckets[time_bucket] )
    			buckets[time_bucket] = { "inflow":0, "outflow":0, "intraflow":0 };
    		
    		// console.log( timestamp, "=>", time_bucket, ":", symbol, from, "=>", to, amount_usd.toFixed(0) );

			if( from == "unknown" )
    			buckets[time_bucket]["inflow"] += amount_usd;
    		else if( to == "unknown" )
    			buckets[time_bucket]["outflow"] += amount_usd;
    		else
    			buckets[time_bucket]["intraflow"] += amount_usd;

    		if( min == 0 || time_bucket < min )
    			min = time_bucket;
    		if( max == 0 || time_bucket > max )
    			max = time_bucket;

    	}

    	// console.log( buckets, min, max );

    	let timeseries = [];
    	for( let timestamp = min; timestamp <= max; timestamp+=60000 )
    	{
    		let inflow = 0;
    		let outflow = 0;
    		if( timestamp in buckets )
    		{
	    		inflow = buckets[timestamp]["inflow"];
	    		outflow = buckets[timestamp]["outflow"];
    			timeseries.push({ "timestamp":timestamp, "inflow":inflow, "outflow":outflow });   		
	    	}
    	}

    	console.log( timeseries );
    	return timeseries;
	}

	_is_entry_supported( item )
	{
		if( item.symbol != "btc" )
    		return false;

		// filter out transfers between same known owner
		if( item.from.owner_type != "unknown" && item.from.owner_type == item.to.owner_type )
			return false;

		// filter out unknown to unknown for now -> not sure how to use them yet
		if( item.from.owner_type == "unknown" && item.to.owner_type == "unknown" )
			return false;

		return true
	}

    bucket_data_exchange( data )
    {
    	let buckets = {};
    	let exchange_inflow = 0;
    	let exchange_outflow = 0;
    	let exchange_intraflow = 0;

    	// console.log( data );
    	// console.log("cursor:", data.cursor);
    	// console.log("count:", data.count);
    	// for( const item of data.transactions )
    	for( const item of data.Items )
    	{
    		// console.log( item );

    		// assume only btc for now - others get more complex with symbols, etc
    		if( ! this._is_entry_supported(item) )
    			continue;

    		let symbol = item.symbol;
    		let amount_usd = item.amount_usd;
    		let timestamp = item.timestamp;
    		let from = item.from.owner_type;
    		if( from != "unknown" ) from = item.from.owner;
    		let to = item.to.owner_type;
    		if( to != "unknown" ) to = item.to.owner;

    		// console.log( timestamp, ":", symbol, from, "=>", to, amount_usd.toFixed(0) );

    		// let key = from + "_" + to;
    		let exchange = "from " + from;
    		let target = "to " + to;
    		// if( from == "unknown" ) exchange = "from unknown";

    		// // old exchange-target mapping
    		// if( ! exchange in buckets || ! buckets[ exchange ] )
    		// 	buckets[ exchange ] = {};
    		// if( ! target in buckets[exchange] || ! buckets[exchange][target] )
    		// 	buckets[exchange][target] = 0;
    		// buckets[exchange][target] += amount_usd;

    		// new target-exchange mapping
    		if( ! target in buckets || ! buckets[ target ] )
    			buckets[ target ] = {};
    		if( ! exchange in buckets[target] || ! buckets[target][exchange] )
    			buckets[target][exchange] = 0;
    		buckets[target][exchange] += amount_usd;

    		// handle cases where we transfer from exchange A to B -> we should count this twice?

    		if( from == "unknown" )
    			exchange_inflow += amount_usd;
    		else if( to == "unknown" )
    			exchange_outflow += amount_usd;
    		else
    			exchange_intraflow += amount_usd;

    	}

    	// need to convert into a nice array for the front-end table
    	// and for the chart we split the data into an x and y array
    	let sorted_keys = Object.keys( buckets ).sort();
    	let sorted_totals = [];
    	let chart_data = [];
    	sorted_keys.forEach( (item, index) => {
    		let sorted_tos = Object.keys( buckets[ item ] ).sort();
    		let entry = [];
    		let chart_entry = { x:[], y:[], name:item, type:"bar" };

    		sorted_tos.forEach( (to, index) => {
    			entry.push( {"target": to, "amount": buckets[item][to] } );
    			chart_entry.x.push( to );
    			chart_entry.y.push( buckets[item][to] );
    		});
	    	sorted_totals.push( {"bucket":item, "totals":entry } );
			chart_data.push( chart_entry );
    	});

    	// console.log( buckets );
		// inflow: num_formatter.format(exchange_inflow),
		// outflow: num_formatter.format(exchange_outflow),
		// intraflow: num_formatter.format(exchange_intraflow),
    	let num_formatter = new Intl.NumberFormat('en-EN', { maximumFractionDigits: 0 });
    	return {buckets:buckets, sort_order: sorted_keys,
    							inflow: exchange_inflow,
    							outflow: exchange_outflow,
    							intraflow: exchange_intraflow,
    							api_cursor:data.cursor, api_count:data.count,
    							sorted_totals: sorted_totals, chart_data:chart_data };

    }


}

// Pav's Crypto Trade Bot


// ML -> given the current kline tuple,
// 		predict it next closing price is up or down (and then repeat again if it will be above or below the fee profit level)

// whale chart mouse-over label should include time component 
// test on phone screen!!???
// setup prod stage + route 53
// poke Shiho? / alpha done
// research ML traiing on this data?


// refactor data concordance so we do our chart and others in one model
// update_db should be paging is result set is over 100!!!!!
// add a smoke-screen test to at least go thorough all routes with default params and get 200 result
// refactor into route-facing class + db_store
// convert exposed methods to a single class instead - no need to expose them anymore
// show data timerange - start + end times 
// google analytics style usage tracking????
// blue/green deployments -> how to repoint URL as part of deployment?
// use 10min offset and loop over using cursor -> no point to loop before each block transaction is done!



// DONE
// overlap whale bucket data (~15h)
// pull in the BTC kline from binance and plot it (1m + 5m)
// TradingVIew lib??? or some other chart?
// setup DB saving of data on second worker thread + pulling of it to render the chart
// deploying to a different stage takes down the first one!!!
// setup incremental updates - test on pegitation first
// setup the front-end chart - bar chart for amounts to/from exchange
// setup front-end static files (using amplify?)
// refactor this for a second entry point we can run localy
// get whale data and bucket it



