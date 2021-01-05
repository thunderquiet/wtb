

provider "aws" {
    region = "ap-northeast-1"
}

locals {
  layer_name = "dep_layer"
  layer_payload = "./dep_layer.zip"
  name = "lambda_api"
  // lambda_name = "currentTimeLambda"
  // zip_file_name = "/tmp/currentTimeLambda.zip"
  // handler_name = "currentTimeLambda.handler"
}

resource "aws_api_gateway_account" "gateway_arn" {
  cloudwatch_role_arn = "${aws_iam_role.lambda_role.arn}"
}

resource "aws_iam_role" "lambda_role" {
	name = "${local.name}"
	assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Effect": "Allow",
      "Sid": ""
    },
    {
    	"Action": "sts:AssumeRole",
		"Principal": {
			"Service": "apigateway.amazonaws.com"
		},
		"Effect": "Allow",
		"Sid": ""
  	}
  ]
}
EOF
}
resource "aws_iam_role_policy" "lambda_role" {
  name = "default"
  role = "${aws_iam_role.lambda_role.id}"
  policy = <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
                "logs:GetLogEvents",
                "logs:FilterLogEvents"
            ],
            "Resource": "*"
        }
    ]
}
EOF
}


resource "aws_api_gateway_rest_api" "wtb_api" {
  name        = "ServerlessExample"
  description = "Terraform Serverless Application Example"
}

resource "aws_lambda_layer_version" "deps_layer" {
    layer_name = "deps_layer"
    filename = "dep_layer.zip"
    compatible_runtimes = ["nodejs12.x"]
    source_code_hash = "${base64sha256(filebase64("dep_layer.zip"))}"
}
resource "aws_lambda_function" "dashboard" {
    function_name = "dashboard"
    handler = "app.dashboard"
    runtime = "nodejs12.x"
    filename = "function.zip"
    source_code_hash = "${base64sha256(filebase64("function.zip"))}"
    layers = [aws_lambda_layer_version.deps_layer.arn]
	role = "${aws_iam_role.lambda_role.arn}"
}
resource "aws_lambda_function" "get_whale_buckets" {
    function_name = "get_whale_buckets"
    handler = "app.get_whale_buckets"
    runtime = "nodejs12.x"
    filename = "function.zip"
    source_code_hash = "${base64sha256(filebase64("function.zip"))}"
    layers = [aws_lambda_layer_version.deps_layer.arn]
	role = "${aws_iam_role.lambda_role.arn}"
}

resource "aws_api_gateway_resource" "proxy" {
   rest_api_id = aws_api_gateway_rest_api.wtb_api.id
   parent_id   = aws_api_gateway_rest_api.wtb_api.root_resource_id
   path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
   rest_api_id   = aws_api_gateway_rest_api.wtb_api.id
   resource_id   = aws_api_gateway_resource.proxy.id
   http_method   = "ANY"
   authorization = "NONE"
}

// deploying each end-point at the gateway level is very painful - instead we use a single entry point we split internally 
resource "aws_api_gateway_integration" "lambda" {
   rest_api_id = aws_api_gateway_rest_api.wtb_api.id
   resource_id = aws_api_gateway_method.proxy.resource_id
   http_method = aws_api_gateway_method.proxy.http_method

   integration_http_method = "POST"
   type                    = "AWS_PROXY"
   uri                     = aws_lambda_function.dashboard.invoke_arn
}
resource "aws_api_gateway_method" "proxy_root" {
   rest_api_id   = aws_api_gateway_rest_api.wtb_api.id
   resource_id   = aws_api_gateway_rest_api.wtb_api.root_resource_id
   http_method   = "ANY"
   authorization = "NONE"
}
resource "aws_api_gateway_integration" "lambda_root" {
   rest_api_id = aws_api_gateway_rest_api.wtb_api.id
   resource_id = aws_api_gateway_method.proxy_root.resource_id
   http_method = aws_api_gateway_method.proxy_root.http_method

   integration_http_method = "POST"
   type                    = "AWS_PROXY"
   uri                     = aws_lambda_function.dashboard.invoke_arn
}

resource "aws_api_gateway_deployment" "wtb_api_deploy" {
   depends_on = [
     aws_api_gateway_integration.lambda,
     aws_api_gateway_integration.lambda_root,
   ]

   rest_api_id = aws_api_gateway_rest_api.wtb_api.id
   stage_name  = "test"
}


resource "aws_iam_policy_attachment" "api_gateway_logs" {
  name = "${local.name}_api_gateway_logs_policy_attach"
  roles = ["${aws_iam_role.lambda_role.id}"]
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
  // policy_arn = "arn:aws:iam::aws:policy/CloudWatchFullAccess"
}

resource "aws_api_gateway_method_settings" "api_settings" {
  rest_api_id = aws_api_gateway_rest_api.wtb_api.id
  // stage_name  = "${aws_api_gateway_stage.example.stage_name}"
  // stage_name  = "${aws_api_gateway_deployment.deployment_production.stage_name}"
  stage_name = "test"
  method_path = "*/*"
  settings {
    metrics_enabled = true
    logging_level = "INFO"
    data_trace_enabled = true
    throttling_rate_limit  = 100
    throttling_burst_limit = 50
  }
}
// resource "aws_cloudwatch_log_group" "lambda" {
//   // name = "/aws/lambda/${var.env}-${join("", split("_",title(var.lambda_name)))}-Lambda"
//   // name = "/aws/lambda/-${join("", split("_",title(var.lambda_name)))}-Lambda"
//   retention_in_days = 7
//   lifecycle {
//     create_before_destroy = true
//     prevent_destroy       = false
//   }
// }

resource "aws_lambda_permission" "apigw" {
   statement_id  = "AllowAPIGatewayInvoke"
   action        = "lambda:InvokeFunction"
   function_name = aws_lambda_function.dashboard.function_name
   principal     = "apigateway.amazonaws.com"
   source_arn = "${aws_api_gateway_rest_api.wtb_api.execution_arn}/*/*"
}

output "base_url" {
  value = aws_api_gateway_deployment.wtb_api_deploy.invoke_url
}

