

const express = require('express');

const wtb_app = require('./app');


const app = express()
const port = 3000

app.get('/', (req, res) => {
	// let r = wtb_app.dashboard( null, null, (r)=>{ res.send( r ) } );
	// let r = wtb_app.get_whale_buckets( null, null, (r)=>{ res.send( r ) } );
	let r = wtb_app.dashboard( null, null, res.send );

})	


app.listen(port, () => {
  console.log(`listening at http://localhost:${port}`)
})


