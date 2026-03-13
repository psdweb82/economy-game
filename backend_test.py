import requests
import sys
import json
from datetime import datetime
import time

class sukunaWAPITester:
    def __init__(self, base_url="https://neon-grind-1.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_base = f"{base_url}/api"
        self.token = None
        self.admin_token = None
        self.test_user_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details="", endpoint=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            print(f"❌ {name} - FAILED: {details}")
        
        self.test_results.append({
            "name": name,
            "endpoint": endpoint,
            "success": success,
            "details": details
        })

    def run_test(self, name, method, endpoint, expected_status=200, data=None, headers=None, use_admin=False):
        """Run a single API test"""
        url = f"{self.api_base}{endpoint}"
        
        # Setup headers
        req_headers = {'Content-Type': 'application/json'}
        if headers:
            req_headers.update(headers)
        
        # Add token if needed
        if use_admin and self.admin_token:
            req_headers['Authorization'] = f'Bearer {self.admin_token}'
        elif self.token and not use_admin:
            req_headers['Authorization'] = f'Bearer {self.token}'

        try:
            if method == 'GET':
                response = requests.get(url, headers=req_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=req_headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=req_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=req_headers, timeout=10)
            else:
                raise Exception(f"Unsupported method: {method}")

            success = response.status_code == expected_status
            details = ""
            
            if not success:
                try:
                    error_data = response.json()
                    details = f"Expected {expected_status}, got {response.status_code}. Response: {error_data}"
                except:
                    details = f"Expected {expected_status}, got {response.status_code}. Response: {response.text[:200]}"
            
            self.log_test(name, success, details, endpoint)
            
            if success:
                try:
                    return response.json()
                except:
                    return {}
            return {}

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}", endpoint)
            return {}

    def test_health_check(self):
        """Test basic health endpoint"""
        result = self.run_test("Health Check", "GET", "/health")
        return result.get("status") == "ok"

    def test_user_registration(self):
        """Test user registration with unique username"""
        timestamp = int(time.time() * 1000)  # Use milliseconds for more uniqueness
        test_username = f"user{timestamp % 100000}"  # Larger range for uniqueness
        test_password = "testpass123"
        
        # Test registration
        result = self.run_test(
            "User Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": test_username, "password": test_password}
        )
        
        if result and "token" in result and "user" in result:
            self.test_user_token = result["token"]
            return result["user"]["username"] == test_username
        return False

    def test_duplicate_registration(self):
        """Test duplicate username registration fails"""
        # Try to register with existing admin username
        result = self.run_test(
            "Duplicate Registration Prevention", 
            "POST", 
            "/auth/register", 
            400,  # Expecting error
            {"username": "pseudotamine", "password": "testpass123"}
        )
        return True  # Success if it returned 400

    def test_admin_login(self):
        """Test admin login with correct credentials"""
        result = self.run_test(
            "Admin Login", 
            "POST", 
            "/auth/login", 
            200,
            {"username": "pseudotamine", "password": "synapthys5082_"}
        )
        
        if result and "token" in result and "user" in result:
            self.admin_token = result["token"]
            user = result["user"]
            # Verify isAdmin is true
            if user.get("isAdmin") == True:
                self.log_test("Admin User Verification", True)
                return True
            else:
                self.log_test("Admin User Verification", False, f"isAdmin is {user.get('isAdmin')}, expected True")
        return False

    def test_regular_user_login(self):
        """Test regular user login"""
        # Create a test user first if needed
        timestamp = int(time.time() * 1000)  # Use milliseconds for more uniqueness
        test_username = f"user{timestamp % 100000}"  # Larger range for uniqueness
        test_password = "testpass123"
        
        # Register user
        reg_result = self.run_test(
            "Regular User Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": test_username, "password": test_password}
        )
        
        if reg_result and "token" in reg_result:
            # Now test login
            login_result = self.run_test(
                "Regular User Login", 
                "POST", 
                "/auth/login", 
                200,
                {"username": test_username, "password": test_password}
            )
            
            if login_result and "token" in login_result:
                self.token = login_result["token"]
                return True
        return False

    def test_admin_add_coins(self):
        """Test admin can add coins to users"""
        if not self.admin_token:
            self.log_test("Admin Add Coins - No Admin Token", False, "Admin token not available")
            return False
        
        # Test adding coins to self
        result = self.run_test(
            "Admin Add Coins to Self", 
            "POST", 
            "/admin/add-coins", 
            200,
            {"targetUsername": "pseudotamine", "amount": 1000},
            use_admin=True
        )
        
        return result and result.get("success") == True

    def test_admin_add_coins_nonexistent_user(self):
        """Test admin adding coins to non-existent user shows error"""
        if not self.admin_token:
            self.log_test("Admin Add Coins Nonexistent User - No Admin Token", False, "Admin token not available")
            return False
        
        # Test adding coins to non-existent user
        result = self.run_test(
            "Admin Add Coins to Nonexistent User", 
            "POST", 
            "/admin/add-coins", 
            404,  # Expecting User not found
            {"targetUsername": "nonexistentuser12345", "amount": 100},
            use_admin=True
        )
        
        return True  # Success if it returned 404

    def test_admin_get_users(self):
        """Test admin can get users list"""
        if not self.admin_token:
            self.log_test("Admin Get Users - No Admin Token", False, "Admin token not available")
            return False
        
        result = self.run_test(
            "Admin Get Users List", 
            "GET", 
            "/admin/users", 
            200,
            use_admin=True
        )
        
        return isinstance(result, list) and len(result) > 0

    def test_shop_items(self):
        """Test getting shop items"""
        result = self.run_test("Get Shop Items", "GET", "/shop/items")
        
        expected_items = ["custom_role", "custom_gradient", "create_clan", "clan_category"]
        return all(item in result for item in expected_items)

    def test_shop_purchase_insufficient_funds(self):
        """Test shop purchase with insufficient funds"""
        if not self.token:
            self.log_test("Shop Purchase Insufficient Funds - No Token", False, "User token not available")
            return False
        
        # Try to purchase expensive item without enough coins
        result = self.run_test(
            "Shop Purchase Insufficient Funds", 
            "POST", 
            "/shop/purchase", 
            400,  # Expecting not enough coins error
            {"itemType": "custom_role", "itemName": "TestRole"}
        )
        
        return True  # Success if it returned 400

    def test_shop_purchase_with_funds(self):
        """Test shop purchase when user has sufficient funds"""
        if not self.token or not self.admin_token:
            self.log_test("Shop Purchase with Funds - No Tokens", False, "Tokens not available")
            return False
        
        # First, admin adds coins to regular user
        # Need to extract username from token or use a known test user
        # For now, let's add coins to a test user
        timestamp = int(time.time() * 1000)
        test_username = f"shop{timestamp % 100000}"
        
        # Register test user
        reg_result = self.run_test(
            "Shop Test User Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": test_username, "password": "testpass123"}
        )
        
        if not reg_result or "token" not in reg_result:
            return False
        
        shop_user_token = reg_result["token"]
        
        # Admin adds coins to this user
        coin_result = self.run_test(
            "Admin Add Coins for Shop Test", 
            "POST", 
            "/admin/add-coins", 
            200,
            {"targetUsername": test_username, "amount": 1500},
            use_admin=True
        )
        
        if not coin_result or not coin_result.get("success"):
            return False
        
        # Now try to purchase with the funded user
        # Temporarily store current token
        old_token = self.token
        self.token = shop_user_token
        
        purchase_result = self.run_test(
            "Shop Purchase Custom Role", 
            "POST", 
            "/shop/purchase", 
            200,
            {"itemType": "custom_role", "itemName": "TestRole"}
        )
        
        # Restore old token
        self.token = old_token
        
        return purchase_result and purchase_result.get("success") == True

    def test_game_submit(self):
        """Test game score submission"""
        if not self.token:
            self.log_test("Game Submit - No Token", False, "User token not available")
            return False
        
        # Submit a reasonable game score
        result = self.run_test(
            "Game Score Submission", 
            "POST", 
            "/game/submit", 
            200,
            {"score": 50, "timePlayedSeconds": 15}
        )
        
        return result and "coinsEarned" in result and "xpEarned" in result

    def test_game_submit_invalid(self):
        """Test game submission with invalid data"""
        if not self.token:
            self.log_test("Game Submit Invalid - No Token", False, "User token not available")
            return False
        
        # Submit invalid score (too high for time played)
        result = self.run_test(
            "Game Submit Invalid Score", 
            "POST", 
            "/game/submit", 
            400,  # Expecting validation error
            {"score": 10000, "timePlayedSeconds": 1}
        )
        
        return True  # Success if it returned 400

    def test_transfer_coins(self):
        """Test coin transfer between users"""
        if not self.token or not self.admin_token:
            self.log_test("Transfer Coins - No Tokens", False, "Tokens not available")
            return False
        
        # Create two test users for transfer
        timestamp = int(time.time() * 1000)
        sender_username = f"send{timestamp % 100000}"
        recipient_username = f"recv{timestamp % 100000}"
        
        # Register sender
        sender_reg = self.run_test(
            "Transfer Sender Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": sender_username, "password": "testpass123"}
        )
        
        # Register recipient
        recipient_reg = self.run_test(
            "Transfer Recipient Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": recipient_username, "password": "testpass123"}
        )
        
        if not sender_reg or not recipient_reg:
            return False
        
        sender_token = sender_reg["token"]
        
        # Admin adds coins to sender
        coin_result = self.run_test(
            "Admin Add Coins for Transfer Test", 
            "POST", 
            "/admin/add-coins", 
            200,
            {"targetUsername": sender_username, "amount": 500},
            use_admin=True
        )
        
        if not coin_result:
            return False
        
        # Perform transfer
        old_token = self.token
        self.token = sender_token
        
        transfer_result = self.run_test(
            "Transfer Coins", 
            "POST", 
            "/transfer", 
            200,
            {"toUsername": recipient_username, "amount": 100}
        )
        
        self.token = old_token
        
        return transfer_result and transfer_result.get("success") == True

    def test_transfer_nonexistent_user(self):
        """Test transfer to non-existent user"""
        if not self.token or not self.admin_token:
            self.log_test("Transfer Nonexistent User - No Tokens", False, "Tokens not available")
            return False
        
        # Create test user with coins
        timestamp = int(time.time() * 1000)
        test_username = f"trans{timestamp % 100000}"
        
        # Register user
        reg_result = self.run_test(
            "Transfer Test User Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": test_username, "password": "testpass123"}
        )
        
        if not reg_result:
            return False
        
        test_token = reg_result["token"]
        
        # Admin adds coins
        coin_result = self.run_test(
            "Admin Add Coins for Transfer Test", 
            "POST", 
            "/admin/add-coins", 
            200,
            {"targetUsername": test_username, "amount": 200},
            use_admin=True
        )
        
        if not coin_result:
            return False
        
        # Try to transfer to non-existent user
        old_token = self.token
        self.token = test_token
        
        transfer_result = self.run_test(
            "Transfer to Nonexistent User", 
            "POST", 
            "/transfer", 
            404,  # Expecting user not found
            {"toUsername": "nonexistentuser12345", "amount": 50}
        )
        
        self.token = old_token
        
        return True  # Success if it returned 404

    def test_daily_bonus_claim(self):
        """Test daily bonus claim functionality"""
        if not self.token:
            self.log_test("Daily Bonus Claim - No Token", False, "User token not available")
            return False
        
        # Test claiming daily bonus
        result = self.run_test(
            "Daily Bonus Claim", 
            "POST", 
            "/bonus/claim", 
            200,
            {"bonusType": "daily"}
        )
        
        return result and result.get("bonusType") == "daily" and result.get("amount") == 50

    def test_weekly_bonus_claim(self):
        """Test weekly bonus claim functionality"""
        if not self.token:
            self.log_test("Weekly Bonus Claim - No Token", False, "User token not available")
            return False
        
        # Test claiming weekly bonus
        result = self.run_test(
            "Weekly Bonus Claim", 
            "POST", 
            "/bonus/claim", 
            200,
            {"bonusType": "weekly"}
        )
        
        return result and result.get("bonusType") == "weekly" and result.get("amount") == 300

    def test_duplicate_daily_bonus_claim(self):
        """Test that daily bonus cannot be claimed twice in 24 hours"""
        if not self.token:
            self.log_test("Duplicate Daily Bonus - No Token", False, "User token not available")
            return False
        
        # Try to claim daily bonus again (should fail)
        result = self.run_test(
            "Duplicate Daily Bonus Claim", 
            "POST", 
            "/bonus/claim", 
            400,  # Expecting error
            {"bonusType": "daily"}
        )
        
        return True  # Success if it returned 400

    def test_admin_give_chest(self):
        """Test admin can give chests to users"""
        if not self.admin_token:
            self.log_test("Admin Give Chest - No Admin Token", False, "Admin token not available")
            return False
        
        # Create a test user for chest giving
        timestamp = int(time.time() * 1000)
        test_username = f"chest{timestamp % 100000}"
        
        # Register test user
        reg_result = self.run_test(
            "Chest Test User Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": test_username, "password": "testpass123"}
        )
        
        if not reg_result:
            return False
        
        # Test giving common chest
        result = self.run_test(
            "Admin Give Common Chest", 
            "POST", 
            "/admin/give-chest", 
            200,
            {"targetUsername": test_username, "chestType": "common"},
            use_admin=True
        )
        
        return result and result.get("success") == True and result.get("chestType") == "common"

    def test_admin_give_chest_invalid_type(self):
        """Test admin giving chest with invalid type"""
        if not self.admin_token:
            self.log_test("Admin Give Chest Invalid Type - No Admin Token", False, "Admin token not available")
            return False
        
        # Test giving invalid chest type
        result = self.run_test(
            "Admin Give Invalid Chest Type", 
            "POST", 
            "/admin/give-chest", 
            400,  # Expecting error
            {"targetUsername": "pseudotamine", "chestType": "invalid_type"},
            use_admin=True
        )
        
        return True  # Success if it returned 400

    def test_admin_give_chest_nonexistent_user(self):
        """Test admin giving chest to non-existent user"""
        if not self.admin_token:
            self.log_test("Admin Give Chest Nonexistent User - No Admin Token", False, "Admin token not available")
            return False
        
        # Test giving chest to non-existent user
        result = self.run_test(
            "Admin Give Chest to Nonexistent User", 
            "POST", 
            "/admin/give-chest", 
            404,  # Expecting user not found
            {"targetUsername": "nonexistentuser12345", "chestType": "rare"},
            use_admin=True
        )
        
        return True  # Success if it returned 404

    def test_chest_open(self):
        """Test opening a chest"""
        if not self.admin_token:
            self.log_test("Chest Open - No Admin Token", False, "Admin token not available")
            return False
        
        # Create a test user and give them a chest
        timestamp = int(time.time() * 1000)
        test_username = f"opener{timestamp % 100000}"
        
        # Register test user
        reg_result = self.run_test(
            "Chest Open User Registration", 
            "POST", 
            "/auth/register", 
            200,
            {"username": test_username, "password": "testpass123"}
        )
        
        if not reg_result:
            return False
        
        test_token = reg_result["token"]
        
        # Admin gives user a chest
        chest_result = self.run_test(
            "Admin Give Chest for Opening Test", 
            "POST", 
            "/admin/give-chest", 
            200,
            {"targetUsername": test_username, "chestType": "epic"},
            use_admin=True
        )
        
        if not chest_result:
            return False
        
        # Get user data to find chest ID
        old_token = self.token
        self.token = test_token
        
        user_result = self.run_test(
            "Get User Data for Chest Opening", 
            "GET", 
            "/auth/me", 
            200
        )
        
        if not user_result or not user_result.get("chests"):
            self.token = old_token
            return False
        
        chest_id = user_result["chests"][0]["id"]
        
        # Test opening the chest
        open_result = self.run_test(
            "Open Chest", 
            "POST", 
            "/chest/open", 
            200,
            {"chestId": chest_id}
        )
        
        self.token = old_token
        
        return open_result and open_result.get("success") == True and "coinsWon" in open_result

    def run_all_tests(self):
        """Run all tests in sequence"""
        print(f"\n🎮 Starting sukunaW Gaming Platform API Tests")
        print(f"Backend URL: {self.api_base}")
        print("=" * 60)
        
        # Basic tests
        self.test_health_check()
        
        # Auth tests
        self.test_user_registration()
        self.test_duplicate_registration()
        self.test_admin_login()
        self.test_regular_user_login()
        
        # Admin tests
        self.test_admin_add_coins()
        self.test_admin_add_coins_nonexistent_user()
        self.test_admin_get_users()
        
        # Shop tests
        self.test_shop_items()
        self.test_shop_purchase_insufficient_funds()
        self.test_shop_purchase_with_funds()
        
        # Game tests
        self.test_game_submit()
        self.test_game_submit_invalid()
        
        # Transfer tests
        self.test_transfer_coins()
        self.test_transfer_nonexistent_user()
        
        # Bonus tests
        self.test_daily_bonus_claim()
        self.test_weekly_bonus_claim()
        self.test_duplicate_daily_bonus_claim()
        
        # Admin chest tests
        self.test_admin_give_chest()
        self.test_admin_give_chest_invalid_type()
        self.test_admin_give_chest_nonexistent_user()
        self.test_chest_open()
        
        # Results
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        failed_tests = [r for r in self.test_results if not r["success"]]
        if failed_tests:
            print(f"\n❌ Failed Tests ({len(failed_tests)}):")
            for test in failed_tests:
                print(f"  • {test['name']}: {test['details']}")
        
        return self.tests_passed == self.tests_run

def main():
    tester = sukunaWAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())