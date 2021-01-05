
'use strict'

const superagent = require('superagent');


//  design:
// dashboard panel with columns
// func to call whale API to get some data
// func to bucket the data and flush to disk?

// exports.dashboard = function(event, context, callback) {
//     console.log('Event: ', JSON.stringify(event, null, '\t'));
//     console.log('Context: ', JSON.stringify(context, null, '\t'));

//     let alert_api = new WhaleAlertApi();
//     console.log( "here1" );
//     alert_api.get_data( (data) => {
//     	console.log( "here3" );
//     	alert_api.bucket_data( data, (buckets) => {
// 			console.log( "here4" );
// 			var response = {
// 			    statusCode: 200,
// 			    body: buckets ,
// 			  }
// 			callback(response);
//     	});
//    	});

//    	console.log( "here5" );

//     // setup pug template and a second api call to fetch bucket data for rendering!!!!!!!!

// 	var response = {
// 	    statusCode: 200,
// 	    headers: {
// 	      'Content-Type': 'text/html; charset=utf-8',
// 	    },
// 	    body: '<p>Hello world 2!</p>',
// 	  }
// 	callback(null, response);
// 	// return response;
// }

// single entry point from tha gateway API to reduce amoount of boiler-plate code in terraform files
exports.dashboard = function (event, context, callback) {

	// take in args for what cmd to run
	//  one for returning the buckets
	//  one for returning the html template

  var response = {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
    body: '<p>Hello world!</p>',
  }

  callback(null, response)
}


// second end-point to fetch bucket data
let get_whale_buckets = function(event, context, callback) {
    let alert_api = new WhaleAlertApi();
    alert_api.get_data( (data) => {
    	console.log( "here3" );
    	alert_api.bucket_data( data, (buckets) => {
			console.log( "here4" );
			var response = {
			    statusCode: 200,
			    body: buckets ,
			  }
			callback(response);
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

	get_data( callback_func )
	{
		console.log( "here2" );
        // const fetch_params = { method: 'GET', mode: 'cors' };
		let start_timestamp = Math.floor(Date.now()/1000) - 3540 ; // last 10min
		let url = "https://api.whale-alert.io/v1/transactions?";
        console.log( "start:", start_timestamp );

        // superagent.get( url ).then(console.log).catch(console.error);

        console.log( "here22" );

        // // invoke error calling the lib?????!!??? -? how to test????
        // superagent.get( url )
        // .query( { "api_key": this.api_key, "start": start_timestamp } )
        // .catch(console.error);
        // .then( data => { console.log( "here2.1" ); callback_func( data ) } )
        // .end( (err, res) => {
        //     if (err) {
        //         console.log ( err );
        //         throw new TypeError(err.statusText);
        //     }
        // });

        // superagent.get(url).query( { "api_key": this.api_key, "start": start_timestamp } ).then(console.log).catch(console.error);
        return true;
    }

    bucket_data( data, callback_func = (d)=>{return d;} )
    {
    	let buckets = {};

    	// console.log( data.body );
    	for( const item of data.body.transactions )
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

    		let key = from + "_" + to;
    		if( ! key in buckets || ! buckets[key] )
    			buckets[key] = 0;
    		buckets[key] += amount_usd;

    	}

    	console.log( buckets );
    	return callback_func( buckets );
    }

}


// setup front-end static files (using amplify?)
// setup the front-end chart
// pull in the BTC price data so we can try to correlate!

// use 10min offset and loop over using cursor -> no point to loop before each block transaction is done!
// setup a process to poll and save to db?



// DONE
// refactor this for a second entry point we can run localy
// get whale data and bucket it



