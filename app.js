
'use strict'

const handlebars = require('handlebars');
const superagent = require('superagent');
const fs = require('fs');

const AWS = require('aws-sdk');


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
exports.dashboard = function (event, context, callback)
{
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
    	case 'update_db':
    		func = update_db;
    		break;
    	default:
    		// return a proper error msg to the user?? -> list valid commands -> swagger!!!
    		console.log( "Command not recognized!", event.queryStringParameters );
    		break;
	}
  
  let callback_func = (data) => { callback(null, data); };
  let res = func(event.queryStringParameters, callback_func );
  console.log( "res:", res );

  if( ! res ) return callback({ statusCode: 500,
			    headers: {'Content-Type': 'application/json'},
			    body: '{"msg":"Errors processing request. Possibly many requests to downstream API."}',
			  })
}



// how to know if we should look localy or in opt?????
function get_page( params, callback )
{
	fs.readFile( config.STATIC_CONTENT_PATH[RUNTIME_ENV] + 'static/main.handlebars', "utf8", (err, source) => {
	    if (err) throw err;
		// var template = handlebars.compile(source);
		// var html = template( {foobar:"my foo"} );
		var html = source; // we will render everything client-side instead

		var response = {
			statusCode: 200,
			headers: {
			  'Content-Type': 'text/html; charset=utf-8'
			},
			body: html,
		}
		return callback(response);
	});
}

function get_front( params, callback )
{
  var response = {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    },
    body: '<p>Hello world!</p>',
  }
  return callback(response);
}

// second end-point to fetch bucket data
function get_whale_buckets( params, callback )
{
	console.log( params );
    let alert_api = new WhaleAlertApi();
    let res = alert_api.get_data( params, ( data) => {
    	alert_api.bucket_data( data, (buckets) => {
			var response = {
			    statusCode: 200,
			    headers: {'Content-Type': 'application/json'},
			    body: JSON.stringify( buckets ),
			  }
			return callback(response);
    	});
   	});
   	console.log( "res bucket:", res );
   	return res;
}


// second end-point to fetch bucket data
function update_db( params, callback )
{
	console.log( params );
    let alert_api = new WhaleAlertApi();
    return alert_api.get_data( params, (data) => {
    	alert_api.save_to_db( data, (res) => {
			var response = {
			    statusCode: 200,
			    headers: {'Content-Type': 'application/json'},
			    body: '{"msg":"all records saved to db"}',
			  }
			return callback(response);
    	});
   	});
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

	get_data( params, callback_func )
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
        .then( data => { /*console.log( data.body );*/ return callback_func( data.body ) } )
        .catch( (err) => {
        	console.log("Too many requests to the API?");
        	console.log(err);
        	exit();	 //leeaving this out seem to hang the entire process??
        	return false;
        });
        // // .end( (err, res) => {
        // //     if (err) {
        // //         console.log ( err );
        // //         throw new TypeError(err.statusText);
        // //     }
        // // });

        console.log("here");
        return true;
    }

    save_to_db( data, callback_func = (d)=>{return d} )
    {
    	
    	let dynamo = new AWS.DynamoDB.DocumentClient();
    	// console.log(data);

    	data.transactions.forEach( (item, index) => {
	    	let record = {
				TableName:"wtb_api_events-"+RUNTIME_ENV,
				Item: item
			}

			// this will automagically ignore/drop duplicates :D
	    	dynamo.put( record, (err) => {
	     		if (err) throw err;
	     	});
    	});
	    
	    // TODO - this should wait and be called only after all records are saved!
	    return callback_func( true );
    }

    bucket_data( data, callback_func = (d)=>{return d;} )
    {
    	let buckets = {};
    	let exchange_inflow = 0;
    	let exchange_outflow = 0;
    	let exchange_intraflow = 0;

    	// console.log( data );
    	console.log("cursor:", data.cursor);
    	console.log("count:", data.count);

    	for( const item of data.transactions )
    	{
    		// console.log( item );

    		// assume only btc for now - others get more complex with symbols, etc
    		if( item.symbol != "btc" )
    			continue;

    		let symbol = item.symbol;
    		let amount_usd = item.amount_usd;
    		let timestamp = item.timestamp;
    		let from = item.from.owner_type;
    		if( from != "unknown" ) from = item.from.owner;
    		let to = item.to.owner_type;
    		if( to != "unknown" ) to = item.to.owner;

    		// filter out transfers between same known owner
    		if( from != "unknown" && from == to )
    			continue;

    		// filter out unknown to unknown for now -> not sure how to use them yet
    		if( from == "unknown" && to == "unknown" )
    			continue;

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
    	return callback_func( {buckets:buckets, sort_order: sorted_keys,
    							inflow: exchange_inflow,
    							outflow: exchange_outflow,
    							intraflow: exchange_intraflow,
    							api_cursor:data.cursor, api_count:data.count,
    							sorted_totals: sorted_totals, chart_data:chart_data } );

    }


}


// setup DB saving of data on second worker thread + pulling of it to render the chart
// setup prod stage + route 53
// convert exposed methods to a single class instead - no need to expose them anymore
// show data timerange - start + end times 
// pull in the BTC price data so we can try to correlate!
// google analytics style usage tracking????

// pull in btc to usd on-exchange liquidity???? how???
// blue/green deployments -> how to repoint URL as part of deployment?

// use 10min offset and loop over using cursor -> no point to loop before each block transaction is done!



// DONE
// deploying to a different stage takes down the first one!!!
// setup incremental updates - test on pegitation first
// setup the front-end chart - bar chart for amounts to/from exchange
// setup front-end static files (using amplify?)
// refactor this for a second entry point we can run localy
// get whale data and bucket it



