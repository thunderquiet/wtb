

const express = require('express');

const wtb_app = require('./app');


const { promisify } = require('util')

let cmd = process.argv.slice()[2];

// we do th eweb server if no commands, otherwise we do the cli utility mode
if( !cmd )
{
	const app = express()
	const port = 3000

	app.get('/', async (req, res) => {
		// TODO - get this to actually render in browser!
		// console.log( req );

		let event = { "headers":req.headers, "queryStringParameters": req.query };

		// event = [{"id": "foo"}, {"id": "bar"}];
		
		// let r = wtb_app.dashboard( event, null, (a, r)=>{ /*console.log(r);*/  res.send( r.body ) } );
		// let r = wtb_app.get_whale_buckets( null, null, (r)=>{ res.send( r ) } );
		// let r = wtb_app.dashboard( null, null, res.send );
		// let r = await promisify(wtb_app.dashboard)( event, null ).then( ()=> {console.log("here!")} ).catch(console.err);
		let r = await wtb_app.dashboard( event, null );
		
		console.log("posting response");
		res.send( r.body )
	})	


	app.listen(port, () => {
	  console.log(`listening at http://localhost:${port}`)
	})

}
else
{
	if( cmd == "get_data" )
	{
		let days = process.argv.slice()[3];
		let end_dateiso = process.argv.slice()[4];
		binance = new wtb_app.BinanceApi();
		dataset = new wtb_app.Dataset( binance );
		let res = dataset.data_fetcher( days, end_dateiso );
	}
	if( cmd == "pred_price" )
	{
		binance = new wtb_app.BinanceApi();
		dataset = new wtb_app.Dataset( binance );
		pred = new wtb_app.PricePredictor( binance, dataset );
		pred.pred();

	}
	else
	{
		// assume DB generation for now, so we just take in params
		let days = process.argv.slice()[2];
		let winsize = process.argv.slice()[3];
		let end_dateiso = process.argv.slice()[4];
		let whitelist = process.argv.slice()[5];

		if( whitelist )
			whitelist = JSON.parse( whitelist );

		console.log( days, winsize, end_dateiso, whitelist );
		binance = new wtb_app.BinanceApi();
		dataset = new wtb_app.Dataset( binance );
		let res = dataset.dataset_generator_cmd( days, winsize, end_dateiso, whitelist );
	}



}




