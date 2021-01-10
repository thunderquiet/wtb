

const express = require('express');

const wtb_app = require('./app');

const { promisify } = require('util')


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



