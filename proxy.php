<?php
    $url = $_SERVER['QUERY_STRING'];
    // print( $url );

    $curl = curl_init();
	curl_setopt($curl, CURLOPT_URL, $url);
	curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($curl, CURLOPT_HEADER, false);
	$data = curl_exec($curl);
	curl_close($curl);

    $jsonData = json_decode($data);

    print( $data );
?>
