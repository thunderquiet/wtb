
'use strict'

const async = require('async');
const { spawn, execSync, spawnSync } = require("child_process");
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
	"DEFAULT_AWS_CONFIG_PATH": "",
	"DEFAULT_UPDATE_DB_FETCH_RANGE": 60 * 5,
	"DEFAULT_CHART_LENGTH": 3600 * 24 * 1000,
	"DEFAULT_CHART_UPDATE_LENGTH": 600 * 1000,
	"BINANCE_FETCH_SIZE": 3600 * 6 * 1000,
	"BINANCE_PRED_FETCH_SIZE": 1800 * 1000
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
	let router = new Router();
    switch ( cmd ) {
    	case 'get_page':
    		func = router.get_page;
    		break;
    	case 'get_front':
    		func = router.get_front;
    		break;
    	case 'get_whale_buckets':
    		func = router.get_whale_buckets;
    		break;
    	case 'get_db_buckets':
    		func = router.get_db_buckets;
    		break;
    	case 'update_db':
    		func = router.update_db;
    		break;
    	case 'get_config':
    		func = router.get_config;
    		break;
    	case 'generate_dataset':
    		func = router.generate_dataset;
    		break;
    	case 'get_price_pred':
    		func = router.price_pred;
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
		let res = await func.bind(router)(event.queryStringParameters);
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
  

class Router
{
	constructor()
	{
		this.alert_api = new WhaleAlertApi();
		this.db_handle = new DBStore();
		this.binance = new BinanceApi();
		this.ds = new Dataset( this.binance );
		this.predictor = new PricePredictor( this.binance, this.ds );
	}

	respond( {body, type = "html", status = 200} )
	{
		let type_header = 'text/html; charset=utf-8';
		if( type == "json" )
			type_header = 'application/json';
		var response = {
			statusCode: status,
			headers: { 'Content-Type': type_header },
			body: body
		}
		return response;
	}

	async price_pred()
	{
		let res = await this.predictor.pred();
		return this.respond( {body:JSON.stringify( res ), type:"text" } );
	}

	async generate_dataset()
	{
		let res = await this.binance.dataset_generator();
		return this.respond( {body:JSON.stringify( res ), type:"text" } );
	}

	async get_config( params )
	{
		return this.respond( {body: JSON.stringify(config, null, '\t'), type:"json" } );
	}


	// how to know if we should look localy or in opt?????
	async get_page( params )
	{
		let source_path = config.STATIC_CONTENT_PATH[RUNTIME_ENV] + 'static/main.handlebars';
		let source = await fs.readFile( source_path, "utf8"); //, (err, source) => {
		// not sure how to handle errors yet
	    // if (err) throw err;
		// var template = handlebars.compile(source);
		var html = source; // we will render everything client-side instead
		return this.respond( {body:html } );;
	}

	async get_front( params )
	{
		return this.respond( {body:'<p>Hello world!</p>' } );
	}

	// second end-point to fetch bucket data
	async get_whale_buckets( params )
	{
		console.log( params );
	    // let api_data = await this.alert_api.get_data( params );
	    let api_data = await this.db_handle.get_from_db( params );
		let buckets =  this.alert_api.bucket_data_exchange( api_data );
		if( !buckets ) return { statusCode: 500, body: 'Something wrong getting data buckets!' };

		return this.respond( {body:JSON.stringify( buckets ), type:"json" } );
	}

	// second end-point to fetch bucket data
	async update_db( params )
	{
		console.log( params );
	    let api_data = await this.alert_api.get_data( params );
	    
	    console.log("got data");
	    if( !api_data ) return { statusCode: 500, body: 'Error fetching data from downstream API!' };

	    let save_res = await this.db_handle.save_to_db( api_data );
	    console.log( "saved data", save_res );

	    if( !save_res ) return { statusCode: 500, body: 'Error saving data!' };

	    let count = api_data.transactions.length;
	    var response = this.respond( {body:'{"msg":"all '+count+' records saved to db"}', type:"json" } );
		console.log( "returning from update_db" );
		return response;
	}


	// second end-point to fetch bucket data
	async get_db_buckets( params )
	{
		//DRY!!!
		console.log( params );
	    let api_data = await this.db_handle.get_from_db( params );
		let buckets =  this.alert_api.bucket_data_exchange( api_data );
		let buckets_timeseries_exchanges =  this.alert_api.bucket_data_timeseries( {data:api_data} );
		let buckets_timeseries_total = this.alert_api.bucket_data_timeseries( {data:api_data, do_allow_cross_unknown_flow:true} )
		buckets["buckets_timeseries_exchanges"] = buckets_timeseries_exchanges;
		buckets["buckets_timeseries_total"] = buckets_timeseries_total;
		if( !buckets ) return { statusCode: 500, body: 'Something wrong getting aws data buckets!' };

		return this.respond( {body:JSON.stringify( buckets ), type:"json" } );
	}

}

class DatasetHeader
{
	constructor( winsize = 0, whitelist = null )
	{
		// 27 features
		this.features = { "raw":[], "bps":[], "macd1":[], "macd5":[], "macd30":[] };
		this.features.raw = ["open", "high", "low", "close", "vol", "quote_asset_vol", "num_of_trades", "taker_vol", "taker_buy_asset_vol"];
    	this.features.bps = ["high_bps", "low_bps", "close_bps"]; // no open_bps because it will always be 0 dy definition
    	this.features.macd1 = ["macd1_ema12", "macd1_ema26", "macd1_macd", "macd1_signal", "macd1_hist"];
    	this.features.macd5 = ["macd5_ema12", "macd5_ema26", "macd5_macd", "macd5_signal", "macd5_hist"];
    	this.features.macd30 = ["macd30_ema12", "macd30_ema26", "macd30_macd", "macd30_signal", "macd30_hist"];

    	this.raw_features_indexes = {
    		"open":1,
    		"high":2,
    		"low":3,
    		"close":4,
    		"vol":5,
    		"quote_asset_vol":7,
    		"num_of_trades":8,
    		"taker_vol":9,
    		"taker_buy_asset_vol":10
    	};

    	this.winsize = winsize;
    	this.whitelist = whitelist
	}

	// asume feature name is valid
	is_feature_in_header( feature_name )
	{
		if( !this.whitelist )
			return true;
		if( this.whitelist && this.whitelist.indexOf( feature_name ) >= 0 )
			return true;
		return false;
	}

	// this calls some other toString before getting here for some reason
	get_str() {
		let header = "";
		let is_first = true;
		for( let category in this.features )
		{
			for( let feature of this.features[category] )
			{
				if( ! this.is_feature_in_header( feature ) )
					continue;

				if( !is_first )
					header += ", ";
				header += feature;
				is_first = false;
			}
		}

		//add a N-frame lookback window -> 30 expands to 810 features
		let header_with_window = header;
		for(let i = 1; i <= this.winsize; i++)
		{
			let win_columns = "";
			let columns = header.split(",");
			for( let column of columns )
				win_columns += ", " + column.trim() + "_" + i.toString().padStart(2, "0");
			header_with_window += win_columns + "";
		}
		header = header_with_window;
		// console.log( header );
		return header;
	}

}

class Dataset
{
	constructor( web_api )
	{
		this.web_api = web_api;
	}

	async dataset_generator_cmd( days, winsize, end_dateiso, whitelist )
	{
		await this._dataset_generator_impl( Number(days), Number(winsize), end_dateiso, whitelist );
	}

	async data_fetcher( days, end_dateiso )
	{
 		console.log("Fetching more data", days, end_dateiso);
 		let end = new Date(end_dateiso)
 		let new_date = end.setDate(end.getDate() - days );
 		let start_date = new Date( new_date );
 		let iso_date = start_date.getUTCFullYear() + '-' + ('0'+ (start_date.getUTCMonth()+1)).slice(-2) + '-' + ('0'+ start_date.getUTCDate()).slice(-2);
		console.log( iso_date );
		await this.save_data(iso_date, end_dateiso);
	 	console.log("done");
        return "all good!";
	}

	async dataset_generator()
	 {
	 	// 1 day => 1440 frames
	 	let days = 1; // about 1sec per day? //37~49sec for 50days // 90sec for 100days
	 	let winsize = 0; // 27 * (winsize + 1) 30 => 837 features
        // let whitelist = ["open", "close", "high", "low", "vol", "num_of_trades"];
        let whitelist = ["open", "close", "macd1_hist", "macd5_hist"];
        // "macd5_hist", "macd30_hist"
        // "macd1_macd", "macd1_signal"
        let end_dateiso = "2021-01-17";
        

	 	// 50+ starts to throw errors -> either throttle or use websockets -> throttle the cheap'n'easy way
	 	// for( days of [1, 2, 10, 20, 50, 100] )
	 	for( days of [200] )
	 	// for( days of [10] )
	 	{
	 		// for( winsize of [0, 1, 10, 20, 30, 50] )
	 		for( winsize of [0, 1, 2, 4, 10] )
	 		{
	 			console.log(days, winsize );
	 			await this.save_data("01/01/2021", "01/28/2021");
	 			// await this._dataset_generator_impl( days, winsize, end_dateiso, whitelist );
	 		}
	 	}
	 	console.log("done");
        return "all good!";
	 }

	async _dataset_generator_impl( days, winsize, end_dateiso, whitelist = null )
	{
	 	// let end_timestamp = Math.floor( Date.now() );
	 	let end_date = new Date(end_dateiso);
	 	console.log( end_date );
        let start_date = new Date(end_date);
        start_date.setDate( end_date.getDate() - days + 1 );

	 	// let datestamp = this.date2datestamp( end_date ) + "_" + this.date2datestamp( start_date );
	 	let datestamp = this.date2datestamp( end_date );
        let postfix = "win"+winsize.toString().padStart(2, "0") +"_"+ days.toString().padStart(3, "0");
        let json_filepath = './datasets/data_binance_'+datestamp+"_"+postfix+'.json';
        let csv_filepath = './datasets/data_binance_'+datestamp+"_"+postfix+'_data.csv';
        let label_filepath = './datasets/data_binance_'+datestamp+"_"+postfix+'_labels.csv';
        let sample_filepath = './datasets/data_binance_'+datestamp+"_"+postfix+'_samples.csv';

        console.log( start_date.toISOString(), end_date.toISOString() );
        let data = await this.load_data( start_date.toISOString(), end_date.toISOString() );
        console.log( data.length );
        // await fs.writeFile(json_filepath, JSON.stringify( data, null, "\t" ), 'utf8');

        console.log( csv_filepath );
        let data_obj = await this.json2csv( data, winsize, whitelist );

        this.save_csv( csv_filepath, data_obj["csv_data"], data_obj["csv_header"] );
        this.save_csv( label_filepath, data_obj["label_data"], data_obj["label_header"] );
        this.save_csv( sample_filepath, data_obj["sample_data"], data_obj["sample_header"] );

	}

	async save_data( start_date, end_date )
	{
		var start = new Date(start_date);
		var end = new Date(end_date);

		var loop = new Date(start);
		while(loop <= end){
			let start_timestamp = new Date(loop); //we clone the obj
			start_timestamp.setHours(0);
			start_timestamp.setMinutes(0);
			start_timestamp.setSeconds(0);
			let end_timestamp = new Date(loop); //we clone the obj
			end_timestamp.setHours(23);
			end_timestamp.setMinutes(59);
			end_timestamp.setSeconds(59);
			let datestamp = this.date2datestamp( loop );
			let data = await this.web_api.get_data( Math.floor(start_timestamp), Math.floor(end_timestamp) );
	        console.log( start_timestamp, end_timestamp, "=>", data.length );
	        await fs.writeFile( "./datasets/data_binance_raw_"+datestamp+".json",
	        					JSON.stringify( data, null, "\t" ), 'utf8');

		   var newDate = loop.setDate(loop.getDate() + 1);
		   loop = new Date(newDate);
		}
	}

	date2datestamp( date_obj )
	{
		return (date_obj.getYear()-100).toString() +
					(date_obj.getMonth()+1).toString().padStart(2, "0") +
					(date_obj.getDate()).toString().padStart(2, "0");
	}


    async json2csv( json_obj, winsize, feature_whitelist = null, is_sample_mode = false )
    {
    	console.log("json2csv");
    	// let json_str = await fs.readFile( json_filepath, "utf8");
    	// let json_obj = JSON.parse( json_str );
    	// console.log( json_obj[0] );

    	let header = new DatasetHeader( winsize, feature_whitelist );
    	// console.log( header.get_str() );

    	let label_header = "next_close_val, next_close_dir, next_close_bps";
    	label_header += ", next_close_val5, next_close_dir5, next_close_bps5";
    	label_header += ", next_close_val30, next_close_dir30, next_close_bps30";
    	label_header += ", next_close_val60, next_close_dir60, next_close_bps60";
    	label_header += ", next_close_val120, next_close_dir120, next_close_bps120";

    	// TODO RSI + Stochastic? + 2std-dev(BB) + bps hist window

    	// extract close price into an array so we can calculate ema on it
    	let close_vec = [];
    	for( let entry of json_obj )
    		close_vec.push( {x:entry[0], y:entry[4]} );
    	let macd = this.calculate_macd( close_vec, [ 1, 5, 30 ] );

    	let csv_data = [];
    	let label_data = [];
    	let sample_data = [];
    	// console.log( "winsize:" + winsize + " close_vec:" + close_vec.length );
    	//ignore last 120 entries because we got no label for 'em 
    	// and start at winsize position because we got no lookback window before that frame
    	let sample_count = json_obj.length * 0.1; // we assume last 10% of data will be used for samples
    	let loop_max = json_obj.length-120;
    	// except when we are in sample mode - then we load everything into samples and we go till the most recent entry
    	if( is_sample_mode == true )
    	{
    		sample_count = json_obj.length;
    		loop_max = json_obj.length;
    	}
    	// console.log( "loop_max:", loop_max );

    	for( let i = winsize; i < loop_max; i++)
    	{
    		let entry = json_obj[i];
    		// console.log( entry );

    		let line = this.extract_line( header, json_obj, i );
    		line += this.prefix_comma( this.extract_bps( header, json_obj, i ));
    		line += this.prefix_comma( this.extract_macd( header, macd, i ));

    		// build the lookback window - it needs to look at the previous data not next data!!!
    		for(let q = -1; q >= -winsize; q--)
	    	{
				line += this.prefix_comma( this.extract_line( header, json_obj, i+q ));
	    		line += this.prefix_comma( this.extract_bps( header, json_obj, i+q ));
	    		line += this.prefix_comma( this.extract_macd( header, macd, i+q ));
	    	}

	    	if( i > (json_obj.length - sample_count) )
	    		sample_data.push( line );
	    	else
	    		csv_data.push( line );

    		// label calcs
    		var label_line = "";
    		if( i < loop_max-120)
    		{
	    		label_line = this.calculate_label( close_vec[i+1].y, entry );
	    		label_line += this.prefix_comma( this.calculate_label( close_vec[i+5].y, entry ));
	    		label_line += this.prefix_comma( this.calculate_label( close_vec[i+30].y, entry ));
	    		label_line += this.prefix_comma( this.calculate_label( close_vec[i+60].y, entry ));
	    		label_line += this.prefix_comma( this.calculate_label( close_vec[i+120].y, entry ));
		    	// if( i < 10 || i > loop_max - 130)
		    	// 	console.log( label_line );
    		}
    		else
    			label_line = "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0"; // blank, but we must keep dims the same??
	    	label_data.push( label_line );
    	}

    	return { "csv_header":header.get_str(), "csv_data":csv_data,
    			"label_header":label_header, "label_data":label_data,
    			"sample_header":"", "sample_data":sample_data };
    }

    async save_csv( filepath, data, header = null  )
    {
    	if( header )
			await fs.writeFile(filepath, header+`\n`, 'utf8');
		else
			await fs.writeFile(filepath, "", 'utf8');

		for( const line of data )
			await fs.appendFile(filepath, line+`\n`, 'utf8');

    }


    prefix_comma( line )
    {
    	if( line != "" )
    		return ", " + line;
    	return line;
    }

    extract_line( header, json_obj, index )
    {
    	let entry = json_obj[index];
    	// console.log( entry, index );
    	// don't even bother with timestamps
    	let line = "";
    	let is_first = true;
    	for( let feature in header.raw_features_indexes )
    		if( header.is_feature_in_header( feature ) )
    		{
    			if( !is_first )
    				line += ", ";
    			line += `${entry[ header.raw_features_indexes[feature] ]}`
    			is_first = false;
    		}
    	return line;
    }

    extract_bps( header, json_obj, index )
    {
    	let entry = json_obj[index];
    	let open =  entry[1];
		let high_bps = this.num2bps( entry[2], open );
		let low_bps = this.num2bps( entry[3], open );
		let close_bps = this.num2bps( entry[4], open );

		// assert high is larger than low!!!!
		if( high_bps < low_bps )
			console.log( "bps values look wrong!" );

		let line = "";
		let is_first = true;
		if( header.is_feature_in_header( "high_bps" ) )
		{
			line += high_bps;
			is_first = false;
		}
		if( header.is_feature_in_header( "low_bps" ) )
		{
			if(　!is_first )
				line += ", ";
			line += high_bps;
			is_first = false;	
		}

		if( header.is_feature_in_header( "close_bps" ) )
		{
			if(　!is_first )
				line += ", ";
			line += high_bps;
			is_first = false;
		}
		return line;
    }

    extract_macd( header, macd_obj, index )
    {
    	let macd = macd_obj;
    	let i = index;

    	let line = "";
    	let is_first = true;
    	for( let macd_prefix of ["1", "5", "30"] )
    	for( let feature of ["ema12", "ema26", "macd", "signal", "hist"] )
    		if( header.is_feature_in_header( "macd" + macd_prefix + "_" + feature ) )
    		{
    			// console.log( macd_prefix, " ", feature, ", ", i );
    			if( !is_first )
    				line += ", ";
    			line += `${macd[ macd_prefix ][ feature ][ i ].y }`
    			is_first = false;
    		}

		// let line = `${macd["1"]["ema12"][i].y}, ${macd["1"]["ema26"][i].y}, ${macd["1"]["macd"][i].y}, ${macd["1"]["signal"][i].y}, ${macd["1"]["hist"][i].y}`;
		// line += `, ${macd["5"]["ema12"][i].y}, ${macd["5"]["ema26"][i].y}, ${macd["5"]["macd"][i].y}, ${macd["5"]["signal"][i].y}, ${macd["5"]["hist"][i].y}`;
		// line += `, ${macd["30"]["ema12"][i].y}, ${macd["30"]["ema26"][i].y}, ${macd["30"]["macd"][i].y}, ${macd["30"]["signal"][i].y}, ${macd["30"]["hist"][i].y}`;
		return line;
    }

    calculate_label( future_close, entry )
    {
		var next_close_dir = future_close < entry[4] ? -1 : 1;
		var next_close_bps = this.num2bps( future_close, entry[1] );
		var label_line = `${future_close}, ${next_close_dir}, ${next_close_bps}`;
		return label_line;
    }

    num2bps( val, base)
    {
		return ( (100 / base * val) - 100 ) * 100;
    }

    calculate_macd( dps, counts )
    {
    	let macd_list = {};
    	for( let base_count of counts)
    	{
    		let ema12 = this.calculateEMA( dps, base_count * 12 );
    		let ema26 = this.calculateEMA( dps, base_count * 26 );
    		let macd = [], hist =[];
			for(var i = 0; i < ema12.length; i++)
				macd.push({x: ema12[i].x, y: (ema12[i].y - ema26[i].y)});
			var ema9 = this.calculateEMA(macd, base_count * 9);
			for(var i = 0; i < ema12.length; i++)
			{
				let score = (macd[i].y - ema9[i].y);
				hist.push({x: ema12[i].x, y: score });
  			}
  			macd_list[base_count] = {"ema12":ema12, "ema26":ema26, "macd":macd, "signal":ema9, "hist":hist };
    	}
    	return macd_list;
    }


    calculateEMA(dps,count) {
      var k = 2/(count + 1);
      var emaDps = [{x: dps[0].x, y: dps[0].y.length ? dps[0].y[3] : dps[0].y}];
      for (var i = 1; i < dps.length; i++) {
        emaDps.push({x: dps[i].x, y: (dps[i].y.length ? dps[i].y[3] : dps[i].y) * k + emaDps[i - 1].y * (1 - k)});
      }
      return emaDps;
    }


    async load_data( start_date, end_date )
    {
    	let prices = [];
		var start = new Date(start_date);
		var end = new Date(end_date);
		var loop = new Date(start);
		while(loop <= end)
    	// while( start_timestamp < end_timestamp )
        {
        	let datestamp = (new Date(loop).getYear()-100).toString() +
        					(new Date(loop).getMonth()+1).toString().padStart(2, "0") +
        					(new Date(loop).getDate()).toString().padStart(2, "0");
        	var filename = "./datasets/data_binance_raw_"+datestamp+".json";
        	// console.log( "datestamp:", datestamp, filename );
    		let json_str = await fs.readFile( filename, "utf8"); //why are new-line chars not removed!!????1
    		// console.log( json_str );
    		let json_obj = JSON.parse( json_str ); //.slice(3, 5);
    		prices = prices.concat(json_obj);	

    		// start_timestamp += 1000 * 3600 * 24;
    		var newDate = loop.setDate(loop.getDate() + 1);
		   	loop = new Date(newDate);
    	}
    	// console.log( prices );
    	return prices;
    }
}


class BinanceApi
{
	constructor()
	{
	}

	async get_latest()
	{
		let api_url = "https://fapi.binance.com/fapi/v1/continuousKlines";
		// console.log( new Date(start_timestamp) );
		let start_timestamp = Date.now() - config.BINANCE_PRED_FETCH_SIZE;
		let end_timestamp = start_timestamp + config.BINANCE_PRED_FETCH_SIZE;
		console.log( start_timestamp, end_timestamp );
		let params = {"pair":"btcusdt", "interval":"1m", "contractType":"PERPETUAL", 
		          "startTime": start_timestamp, "endTime": end_timestamp };
		let prices = await this.fetch_url( api_url, params )
	    return prices;
	}

	async get_data( start_timestamp, end_timestamp )
    {
        // https://fapi.binance.com/fapi/v1/continuousKlines?pair=btcusdt&interval=5m&contractType=PERPETUAL
        let api_url = "https://fapi.binance.com/fapi/v1/continuousKlines";
        let prices = [];
        
        // the API gets only ~8h of data per call, so we loop over
        // let end_timestamp = Math.floor(Date.now());
        // let start_timestamp = end_timestamp - config.DEFAULT_CHART_LENGTH; //24h
        
        
        // console.log( start_timestamp, "<", end_timestamp);
        while( start_timestamp < end_timestamp )
        {
          // console.log( new Date(start_timestamp) );
          let chunk_end_timestamp = start_timestamp + config.BINANCE_FETCH_SIZE;
          // console.log( start_timestamp + config.BINANCE_FETCH_SIZE, end_timestamp );
          let params = {"pair":"btcusdt", "interval":"1m", "contractType":"PERPETUAL", 
                      "startTime": start_timestamp, "endTime": chunk_end_timestamp };
          let new_prices = await this.fetch_url( api_url, params )
          
          prices = [...prices, ...new_prices ];
          start_timestamp += config.BINANCE_FETCH_SIZE;

        }
        return prices;
    }


    async fetch_url( url, query = null )
    {
    	console.log( url, query );
    	return await superagent.get( url )
        .query( query )
        .then( data => { return (data.body); } )
        .catch( (err) => {
        	console.log("Too many requests to the API?");
        	console.log(err);
        	resolve(false);
        });
        console.log("returning true from get_data");

      // if( query )
      // {
      //   if( url.slice(-1) != "?" )
      //     url += "?";
      //   for( let key in query )
      //   {
      //     url += key + "=" + query[key] + "&";
      //   }
      // }
      // // console.log("fetching", url);
      // return await fetch( url )
      //   .then(response => response.json())
      //   .then(data => {
      //     return data;
      //   }); 
    
    }
}


class PricePredictor
{
	constructor( web_api, dataset )
	{
		this.web_api = web_api;
		this.dataset = dataset;
	}

	async pred()
	{
		// get last ~20 frames from Binance
		let prices = await this.web_api.get_latest();
		let winsize = 10;
		let whitelist = ["open", "close", "vol", "num_of_trades", "macd1_hist", "macd1_macd", "macd1_signal", "macd5_hist", "macd5_macd", "macd5_signal"];

		// format it using dataset class calls to get a single sample point
		let csv_obj = await this.dataset.json2csv( prices, winsize, whitelist, true )

		// console.log( csv_obj["sample_data"].slice(-1) );

		// then call our pred model
		// get model details -> published model.meta file ???!!!!!!
		let mode = "pred";
		let model = "model_210205.xgboost";
		let ppv = 0.636; //fake value we should be pulling from model meta file
		let metric = "bps60+10";
		const pred = spawnSync("./PriceRunner", [ mode, model, csv_obj["sample_data"].slice(-1) ]);
		let output = String(pred.stdout);
		let score = output.split("\n")[3].slice(5,-1)
		// console.log(  );

		return { "model":model, "ppv":ppv, "pred":score, "metric":metric };
	}


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

    async get_data( params )
	{
		return new Promise(resolve => {
			// let start_timestamp = Math.floor(Date.now()/1000) - 3540 ; // last 59min
			let start_timestamp = Math.floor(Date.now()/1000) - config.DEFAULT_UPDATE_DB_FETCH_RANGE ; // last 5min
			let url = "https://api.whale-alert.io/v1/transactions?";

	        // https://api.whale-alert.io/v1/transactions?api_key=oCAcALPSl98tCbEnzMuq2n0gwbYPClZy&start=1609806534
	        // let api_key = "oCAcALPSl98tCbEnzMuq2n0gwbYPClZy";
	        // let m_url = url + "api_key="+this.api_key+"&start="+start_timestamp; 
	        // we are going to roll our own proxy in php - like 5 lines of code :D - I forget how easy php is
	        // let f_url = "https://ixspeed.com/proxy.php?"+m_url;
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


	// assume 1m freq
	bucket_data_timeseries( {data:data, do_allow_cross_unknown_flow} )
	{
		let buckets = {};
		let min = 0;
		let max = 0;
		for( const item of data.Items )
    	{
    		if( ! this._is_entry_supported({ item:item, do_allow_cross_unknown_flow:do_allow_cross_unknown_flow})) continue;

    		let amount_usd = item.amount_usd;
    		let timestamp = item.timestamp;
    		let from = item.from.owner_type;
    		if( from != "unknown" ) from = item.from.owner;
    		let to = item.to.owner_type;
    		if( to != "unknown" ) to = item.to.owner;

    		// floor to nearest minute
    		let time_bucket = Math.floor(timestamp / 60) * 60 * 1000;
    		if( ! buckets[time_bucket] )
    			buckets[time_bucket] = { "inflow":0, "outflow":0, "intraflow":0, "transaction_count":0 };
    		// console.log( timestamp, "=>", time_bucket, ":", symbol, from, "=>", to, amount_usd.toFixed(0) );

			if( from == "unknown" )
    			buckets[time_bucket]["inflow"] += amount_usd;
    		else if( to == "unknown" )
    			buckets[time_bucket]["outflow"] += amount_usd;
    		else
    			buckets[time_bucket]["intraflow"] += amount_usd;
    		buckets[time_bucket]["transaction_count"]++;

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
    			timeseries.push({ "timestamp":timestamp, "transaction_count": buckets[timestamp]["transaction_count"],
    								"inflow":inflow, "outflow":outflow,
    								"vol": inflow + outflow , "net": inflow - outflow });
	    	}
    	}

    	// console.log( timeseries );
    	return timeseries;
	}

	_is_entry_supported( {item, do_allow_cross_unknown_flow = null} )
	{
		if( item.symbol != "btc" )
    		return false;

		// filter out transfers between same known owner
		if( item.from.owner_type != "unknown" && item.from.owner_type == item.to.owner_type )
			return false;

		// filter out unknown to unknown for now -> not sure how to use them yet
		if( !do_allow_cross_unknown_flow && item.from.owner_type == "unknown" && item.to.owner_type == "unknown" )
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
    		if( ! this._is_entry_supported( {item:item} )) continue;

    		let symbol = item.symbol;
    		let amount_usd = item.amount_usd;
    		let timestamp = item.timestamp;
    		let from = item.from.owner_type;
    		if( from != "unknown" ) from = item.from.owner;
    		let to = item.to.owner_type;
    		if( to != "unknown" ) to = item.to.owner;

    		// console.log( timestamp, ":", symbol, from, "=>", to, amount_usd.toFixed(0) );

    		let exchange = "from " + from;
    		let target = "to " + to;

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

    	let num_formatter = new Intl.NumberFormat('en-EN', { maximumFractionDigits: 0 });
    	return {buckets:buckets, sort_order: sorted_keys,
    							inflow: exchange_inflow,
    							outflow: exchange_outflow,
    							intraflow: exchange_intraflow,
    							api_cursor:data.cursor, api_count:data.count,
    							sorted_totals: sorted_totals, chart_data:chart_data };
    }


}


class DBStore{

	constructor()
	{
		this.db_handle = new AWS.DynamoDB.DocumentClient();

	}


    async save_to_db( data )
    {
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
			await this._save_data( item )
			.catch((error) => {
			    console.log(error);
			   throw error; //don't care about this error, just continue
			});
    	}
    	return {"body": "all good", statusCode: 200};

    }

	async _save_data( item )
	{
	  let params = {
	    Item: item,
	    TableName:"wtb_api_events-"+RUNTIME_ENV,
	  };
	  return this.db_handle.put(params).promise();
	}

	async get_from_db( {start_timestamp, end_timestamp} )
	{
		// start_timestamp = Math.floor(Date.now()/1000) - 3540 ; // last 59min -> move to front-end param
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

		let data = await this.db_handle.query( params ).promise();
		// handle no data!
		console.log( "data count:", data.Count );
		return data;
	}
}

module.exports.BinanceApi = BinanceApi;
module.exports.PricePredictor = PricePredictor;
module.exports.Dataset = Dataset;




// Pav's Whale Crypto Trade Bot
// HFT (100ms ~ 60s) vs scalping (1min ~ 1h) vs day-trade ( 10min ~ 1day)


// get mode training to run on zina
// retrain the model for latest data
// can we train a model for sell predictions?

// setup C++ code on lambda -> via node addon? or direct c++ lambda endpoint!!!
// setup local to S3 model deployment pipeline -> models are generally ~1mb
// reduce dynamo writes!!! -> dedup whale data? filter out more of it? remove unused indexes? 

// add RSI, stockastick and other technical indicators as features
// add whale features - EMA with delay 
// method to adjust option values universe based on avg results from the tuner? -> auto-tuner
// can we predict true negatives? -> using BPS-N metric?
// go through that research paper -> add more features? how to replicate results? -> print it


// try other algos? deep learning???
// add frames of recent samples -> try just macd-hist of last 30min
// Iceberg detection ^> orderbook trends over time? -> ML? -> tradebook repeating order price + quantity???
// MACD RT color box buy/hold/sell



// stripline - changebcolor based on direction of mmove
// why the high energy use? -> debug memory usage!
// can use "close" instead of Mark price for plotting!!!!!!!!

// Frontend: Add RSI + Stochastic + Boulinger stuff
// initial load looks too slow -> smaller chunks + partial renders???
// custom Binance order "preset"

// mlpack methods to do classification
// how many miliseconds to execute an order???? -> ~60ms for simplest API request
// whale data should auto-refrehs as well!
// add support for backend WebSockets! 

// can we correlate flows and price data? -> correlation coeficient
// research ML training on this data?
// setup prod stage + route53
// update details flows chart to match navigator selected range
// get_db_bucket taking over 4.5sec!!!!
// refactor data concordance so we do our chart and others in one model
// add a smoke-screen test to at least go thorough all routes with default params and get 200 result
// show data timerange - start + end times 
// google analytics style usage tracking????
// blue/green deployments -> how to repoint URL as part of deployment?
// use 10min offset and loop over using cursor -> no point to loop before each block transaction is done!



// DONE
//  get local node code hitting the lib and posting pred to the local dashbaord!!!!!
// method to train a single model given params and then flush it to disk
// method to take in a model from disk and 1 frame to output buy or hold prediction (30min + 60min + 2 models for selling?)
// rerun the features -> tune using whitelist
// fetch recent data from Binance
// try retunning for 50 days ago -> test that our model is generic enough to work with other data
// convert all params to a DS + tunning the boost params 
// adjust evaluation output to be just PPV metric and 1 row for various threshold values
// anything special in xgboost for classification over regression?????
// try bps120 and try 20
// try 50days 50day-ago
// load more back data and tune xgboost?
// train xgboost on macd
// ML -> given the current kline tuple,
// 		predict it next closing price is up or down (and then repeat again if it will be above or below the fee profit level)
// go through the algo options int the docs
// param turner level
// node func to build the dataset using binance data
// convert dataset generation to go via cmd
// why 0.5 predicted values for all other algos -> "false" must be 0 not -1!
// get data loader to work using heap instead of stack!!!!!!
// go hrough how xgboost is meant to work
// option to pause RT updates
// MACD needs to update RT as well!!!
// RT chart updates 
// RT updates / auto-refresh evey 1min? + stripline
// MACD chart
// update_db should be paging if result set is over 100!!!!! -> reduces time range so sohuld be fine
// why the failures in lambda from db updates???? -> due to 3sec default execution limit
// refactor into route-facing class + db_store
// convert exposed methods to a single class instead - no need to expose them anymore
// route to get config params from backend?!
// poke Shiho? / alpha done
// test on phone screen!!???
// whale chart mouse-over label should include time component 
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



